import { processAgentMessage } from "@/lib/ai/agent";
import { transcribeWhatsAppAudio } from "@/lib/ai/transcribe";
import { isRateLimited, withConversationLock } from "@/lib/commerce/locks";
import { createWhatsAppOrder } from "@/lib/commerce/orders";
import { normalizePhone } from "@/lib/commerce/phone";
import {
  sendWhatsAppText,
  sendWhatsAppImage,
  sendWhatsAppButtons,
  sendWhatsAppList,
  markMessageAsRead,
  downloadWhatsAppMedia,
} from "@/lib/whatsapp/client";
import { explainWhatsAppGraphError, resolveWhatsAppAuth } from "@/lib/whatsapp/credentials";
import { isSupabaseEnabled, uploadChatMedia } from "@/lib/db/supabase-sync";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  nowIso,
  readDb,
  resolveWhatsAppConfig,
  uid,
  writeDb,
} from "@/lib/db/store";
import type { AgentResponse } from "@/types/database";

const inflightInbound = new Set<string>();

interface WebhookMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  context?: { id?: string; from?: string };
  image?: { caption?: string; id?: string };
  video?: { caption?: string; id?: string };
  audio?: { id?: string; mime_type?: string };
  voice?: { id?: string; mime_type?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
}

interface WebhookEntry {
  changes: Array<{
    value: {
      metadata: { phone_number_id: string };
      contacts?: Array<{ profile: { name: string }; wa_id: string }>;
      messages?: WebhookMessage[];
      statuses?: unknown[];
    };
    field: string;
  }>;
}

export async function handleWhatsAppWebhook(body: { entry?: WebhookEntry[] }) {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const { metadata, messages, contacts } = change.value;
      if (!messages?.length) continue;

      const resolved = await resolveWhatsAppConfig(metadata.phone_number_id);
      const { config, business } = resolved;
      if (!config || !business) {
        console.error("WhatsApp webhook unmatched phone_number_id:", metadata.phone_number_id);
        continue;
      }

      const auth = resolveWhatsAppAuth(config);
      const accessToken = auth.accessToken;
      const phoneNumberId = metadata.phone_number_id || auth.phoneNumberId;
      const agentOn = config.agent_enabled !== false;

      for (const msg of messages) {
        if (inflightInbound.has(msg.id)) continue;
        inflightInbound.add(msg.id);
        try {
        if (isRateLimited(`wa:${metadata.phone_number_id}:${msg.from}`)) {
          console.error("WhatsApp inbound rate limited", msg.from);
          continue;
        }
        const inbound = await resolveInboundText(
          msg,
          auth.accessToken,
          config.groq_api_key || process.env.GROQ_API_KEY || null
        );
        if (!inbound) continue;
        const textBody = inbound.text;

        if (accessToken && phoneNumberId) {
          await markMessageAsRead(phoneNumberId, accessToken, msg.id).catch((err) => {
            console.error("WhatsApp mark-read failed:", err);
          });
        }

        const db = await readDb();
        if (db.messages.some((m) => m.whatsapp_message_id === msg.id)) continue;

        const customerPhone = msg.from;
        const customerPhoneNorm = normalizePhone(customerPhone) || customerPhone;
        const customerWaName = contacts?.[0]?.profile?.name ?? null;
        let customer = db.customers.find(
          (c) =>
            c.business_id === business.id &&
            (c.phone === customerPhone ||
              c.whatsapp_id === customerPhone ||
              normalizePhone(c.phone) === customerPhoneNorm ||
              normalizePhone(c.whatsapp_id || "") === customerPhoneNorm)
        );
        if (!customer) {
          customer = {
            id: uid(),
            business_id: business.id,
            name: customerWaName || "WhatsApp Customer",
            phone: customerPhoneNorm,
            email: null,
            address: null,
            notes: null,
            whatsapp_id: customerPhone,
            total_orders: 0,
            total_spent: 0,
            created_at: nowIso(),
          };
          db.customers.push(customer);
        } else if (customerWaName && customer.name === "WhatsApp Customer") {
          customer.name = customerWaName;
        }

        let conversation = db.conversations.find(
          (c) => c.business_id === business.id && c.customer_phone === customerPhone
        );
        if (!conversation) {
          conversation = {
            id: uid(),
            business_id: business.id,
            customer_phone: customerPhone,
            customer_id: customer.id,
            customer_name: customerWaName || customer.name,
            status: agentOn ? "active" : "handed_off",
            pending_order_data: null,
            agent_paused: false,
            last_message_at: nowIso(),
            created_at: nowIso(),
          };
          db.conversations.push(conversation);
        } else {
          conversation.customer_id = customer.id;
          if (customerWaName) conversation.customer_name = customerWaName;
          if (!agentOn) conversation.status = "handed_off";
        }
        if (!conversation) continue;

        const inboundText = textBody || (msg.context?.id ? "ye product chahiye" : "[message]");
        const voiceOk =
          (msg.type === "audio" || msg.type === "voice") &&
          !/^\[voice (message|failed)/i.test(inboundText.trim());
        const storedInbound = voiceOk ? `🎤 ${inboundText}` : inboundText;
        const inboundType =
          msg.type === "image"
            ? "image"
            : msg.type === "video"
              ? "video"
              : msg.type === "audio" || msg.type === "voice"
                ? "audio"
                : msg.type === "interactive"
                  ? "interactive"
                  : "text";

        db.messages.push({
          id: uid(),
          business_id: business.id,
          conversation_id: conversation.id,
          direction: "inbound",
          message_type: inboundType,
          content: storedInbound,
          whatsapp_message_id: msg.id,
          image_url: inbound.mediaUrl || null,
          created_at: nowIso(),
        });
        conversation.last_message_at = nowIso();
        await writeDb(db);

        await withConversationLock(conversation.id, async () => {
        const latestAfterLock = await readDb();
        const locked =
          latestAfterLock.conversations.find((c) => c.id === conversation.id) || conversation;
        if (!locked) return;

        const chatAgentOn = agentOn && locked.agent_paused !== true;
        if (!chatAgentOn) {
          return;
        }

        if (!accessToken || !phoneNumberId) {
          await recordWhatsAppError(
            business.id,
            `Token missing — ${customerPhone} ka message save ho gaya. Dashboard → WhatsApp pe token save karke Chats se reply karein.`
          );
          return;
        }

        const history = latestAfterLock.messages
          .filter((m) => m.conversation_id === locked.id)
          .slice(-40)
          .map((m) => ({
            role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
            content: m.content.replace(/^🎤\s*/, ""),
          }));

        const products = latestAfterLock.products
          .filter((p) => p.business_id === business.id && p.is_active)
          .map((p) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            description: p.description || undefined,
            image_url: p.image_url,
            category: p.category,
            sizes: p.sizes,
            stock: p.stock ?? null,
            sku: p.sku ?? null,
          }));

        const referredProduct = await resolveReferredProduct({
          conversationId: locked.id,
          contextId: msg.context?.id,
          text: inboundText,
          products,
        });

        const bizOrders = latestAfterLock.orders.filter((o) => o.business_id === business.id);
        const customerOrders = bizOrders.filter((o) => {
          const c = latestAfterLock.customers.find((cu) => cu.id === o.customer_id);
          return (
            c?.id === locked.customer_id ||
            c?.phone === customerPhone ||
            c?.whatsapp_id === customerPhone ||
            o.whatsapp_conversation_id === locked.id
          );
        });

        let agentResponse: AgentResponse;
        try {
          agentResponse = await processAgentMessage({
          message: inboundText,
          conversationHistory: history,
          businessName: business.name,
          agentName: config.agent_name,
          products,
          pendingOrder: locked.pending_order_data,
          customerName: locked.customer_name,
          instructions: config.agent_instructions || config.agent_greeting,
          referredProduct,
          groqApiKey: config.groq_api_key,
          easypaisaNumber: config.easypaisa_number,
          jazzcashNumber: config.jazzcash_number,
          selectedCategory: inbound.category,
          seeMoreProductId: inbound.seeMoreId,
          orderStats: {
            total: bizOrders.length,
            delivered: bizOrders.filter((o) => o.order_status === "delivered").length,
            pending: bizOrders.filter((o) => o.order_status === "pending" || o.order_status === "processing").length,
            customerTotal: customerOrders.length,
            recentOrders: customerOrders
              .filter((o) => o.order_status !== "cancelled")
              .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
              .slice(0, 8)
              .map((o) => ({
                order_number: o.order_number,
                status: o.order_status,
                total: o.total,
                created_at: o.created_at,
              })),
          },
        });
        if (!agentResponse?.reply?.trim()) {
          throw new Error("Empty agent reply");
        }
        } catch (err) {
          console.error("Agent failed, sending fallback:", err);
          agentResponse = {
            intent: "general",
            reply:
              "Maaf kijiye, reply ruk gaya tha. Aap ka last message save hai — ek line mein dobara likh dein, main continue karta hoon.",
            parsed_order: locked.pending_order_data as AgentResponse["parsed_order"],
            should_create_order: false,
            order_id: null,
            confidence: 0.2,
            needs_human: true,
            skip_media: true,
          };
        }

        let orderId: string | null = null;
        let createdSummary: string | null = null;
        if (agentResponse.should_create_order && agentResponse.parsed_order) {
          const created = await createWhatsAppOrder({
            conversationId: locked.id,
            businessId: business.id,
            customerPhone,
            orderData: agentResponse.parsed_order,
            shopNotes: config.agent_instructions,
            businessName: business.name,
          });
          if (created.success) {
            orderId = created.orderId;
            agentResponse.order_id = created.orderId;
            createdSummary = `✅ Order confirm ho gaya.\n\nOrder #${created.orderNumber}\nTotal: Rs.${created.total}\nPayment: ${created.paymentMethod}\n\nAap ka order processing ke liye save ho gaya hai.`;
          } else {
            agentResponse.should_create_order = false;
            agentResponse.reply = created.message;
          }
        } else if (agentResponse.parsed_order) {
          const latest = await readDb();
          const live = latest.conversations.find((c) => c.id === locked.id);
          if (live) {
            const po = agentResponse.parsed_order;
            const empty = !po.products?.length && !po.customer_name && !po.address && !po.payment_method;
            live.pending_order_data = empty ? null : (po as unknown as Record<string, unknown>);
            live.status = agentResponse.needs_human ? "handed_off" : empty ? "active" : "awaiting_confirmation";
            live.last_message_at = nowIso();
            await writeDb(latest);
          }
        } else if (agentResponse.needs_human) {
          const latest = await readDb();
          const live = latest.conversations.find((c) => c.id === locked.id);
          if (live) {
            live.status = "handed_off";
            live.last_message_at = nowIso();
            await writeDb(latest);
          }
        }

        if (agentResponse.needs_human) {
          await recordAttention(business.id, locked.id, customerPhone, inboundText);
        }

        let replyText = createdSummary || agentResponse.reply;

        if (accessToken && phoneNumberId && replyText.trim()) {
          await markMessageAsRead(phoneNumberId, accessToken, msg.id, true).catch(() => {});
          try {
            await sendAgentOutbound({
              phoneNumberId,
              accessToken,
              customerPhone,
              businessId: business.id,
              conversationId: locked.id,
              replyText,
              agentResponse,
            });
          } catch (error) {
            console.error("WhatsApp send failed:", error);
            await recordWhatsAppError(business.id, String(error));
            if (orderId && agentResponse.parsed_order) {
              const latest = await readDb();
              const live = latest.conversations.find((c) => c.id === locked.id);
              if (live) {
                live.pending_order_data = agentResponse.parsed_order as unknown as Record<string, unknown>;
                live.status = "awaiting_confirmation";
                await writeDb(latest);
              }
            }
            try {
              await sendWhatsAppText({
                phoneNumberId,
                accessToken,
                to: customerPhone,
                message: replyText.slice(0, 4000),
              });
            } catch (retryErr) {
              console.error("WhatsApp fallback text failed:", retryErr);
            }
          }
        }
        });
        } finally {
          setTimeout(() => inflightInbound.delete(msg.id), 90_000);
        }
      }
    }
  }
}

async function resolveInboundText(
  msg: WebhookMessage,
  accessToken: string | null,
  groqKey: string | null
): Promise<{ text: string; category: string | null; seeMoreId: string | null; mediaUrl?: string | null } | null> {
  if (msg.type === "text") {
    const body = msg.text?.body?.trim();
    if (!body) return null;
    return { text: body, category: null, seeMoreId: null };
  }
  if (msg.type === "image") {
    const mediaUrl = await saveInboundMedia(accessToken, msg.image?.id, "image/jpeg");
    return { text: msg.image?.caption || "[photo]", category: null, seeMoreId: null, mediaUrl };
  }
  if (msg.type === "video") {
    const mediaUrl = await saveInboundMedia(accessToken, msg.video?.id, "video/mp4");
    return { text: msg.video?.caption || "[video]", category: null, seeMoreId: null, mediaUrl };
  }
  if (msg.type === "interactive") {
    const id = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || "";
    const title = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
    if (id.startsWith("more:")) {
      return { text: title || "see more", category: null, seeMoreId: id.slice(5) };
    }
    if (id.startsWith("cat:")) {
      const cat = id.slice(4);
      return {
        text: cat === "all" ? "show catalog" : `show ${cat} category`,
        category: cat === "all" ? null : cat,
        seeMoreId: null,
      };
    }
    if (id === "menu:catalog") return { text: "show catalog", category: null, seeMoreId: null };
    if (id === "menu:order") return { text: "I want to place an order", category: null, seeMoreId: null };
    if (id === "menu:pay") return { text: "payment methods", category: null, seeMoreId: null };
    return { text: title || id || "ok", category: null, seeMoreId: null };
  }
  if (msg.type === "audio" || msg.type === "voice") {
    const mediaId = msg.audio?.id || msg.voice?.id;
    if (!mediaId || !accessToken) {
      console.error("Voice message missing media id or access token");
      return { text: "[voice failed]", category: null, seeMoreId: null };
    }
    try {
      const file = await downloadWhatsAppMedia(accessToken, mediaId);
      console.log("Voice media downloaded", file.bytes.length, file.mimeType);
      const mediaUrl = await saveBytesAsChatMedia(file.bytes, file.mimeType).catch(() => null);
      const spoken = await transcribeWhatsAppAudio({
        groqApiKey: groqKey,
        bytes: file.bytes,
        mimeType: msg.audio?.mime_type || msg.voice?.mime_type || file.mimeType,
      });
      if (!spoken) {
        return { text: "[voice failed]", category: null, seeMoreId: null, mediaUrl };
      }
      return { text: spoken, category: null, seeMoreId: null, mediaUrl };
    } catch (err) {
      console.error("Voice transcribe failed:", err);
      return { text: "[voice failed]", category: null, seeMoreId: null };
    }
  }
  return null;
}

function mediaExt(mime: string) {
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  if (mime.startsWith("audio/")) return ".ogg";
  if (mime.startsWith("video/")) return ".mp4";
  return ".bin";
}

async function saveBytesAsChatMedia(bytes: Buffer, mimeType: string) {
  return uploadChatMedia(`${uid()}${mediaExt(mimeType)}`, bytes, mimeType);
}

async function saveInboundMedia(accessToken: string | null, mediaId?: string, fallbackMime = "application/octet-stream") {
  if (!mediaId || !accessToken) return null;
  try {
    const file = await downloadWhatsAppMedia(accessToken, mediaId);
    return await saveBytesAsChatMedia(file.bytes, file.mimeType || fallbackMime);
  } catch (err) {
    console.error("Inbound media save failed:", err);
    return null;
  }
}

async function storeOutbound(params: {
  businessId: string;
  conversationId: string;
  content: string;
  messageType: string;
  whatsappId?: string | null;
  imageUrl?: string | null;
  productName?: string | null;
}) {
  const db = await readDb();
  db.messages.push({
    id: uid(),
    business_id: params.businessId,
    conversation_id: params.conversationId,
    direction: "outbound",
    message_type: params.messageType,
    content: params.content,
    whatsapp_message_id: params.whatsappId ?? null,
    image_url: params.imageUrl ?? null,
    product_name: params.productName ?? null,
    created_at: nowIso(),
  });
  const conv = db.conversations.find((c) => c.id === params.conversationId);
  if (conv) conv.last_message_at = nowIso();
  await writeDb(db);
}

async function sendAgentOutbound(params: {
  phoneNumberId: string;
  accessToken: string;
  customerPhone: string;
  businessId: string;
  conversationId: string;
  replyText: string;
  agentResponse: AgentResponse;
}) {
  const { phoneNumberId, accessToken, customerPhone } = params;
  const dbDup = await readDb();
  const lastOut = [...dbDup.messages]
    .reverse()
    .find((m) => m.conversation_id === params.conversationId && m.direction === "outbound");
  if (
    lastOut &&
    lastOut.content.trim() === params.replyText.trim() &&
    Date.now() - new Date(lastOut.created_at).getTime() < 45_000
  ) {
    return;
  }
  const skipExtra = Boolean(params.agentResponse.skip_media);
  const buttons = skipExtra ? [] : params.agentResponse.quick_replies?.slice(0, 3) || [];
  let sentText = false;
  if (buttons.length && params.replyText.trim()) {
    try {
      const sent = await sendWhatsAppButtons({
        phoneNumberId,
        accessToken,
        to: customerPhone,
        body: params.replyText,
        buttons,
      });
      await storeOutbound({
        businessId: params.businessId,
        conversationId: params.conversationId,
        content: params.replyText,
        messageType: "interactive",
        whatsappId: sent?.messages?.[0]?.id ?? null,
      });
      sentText = true;
    } catch (err) {
      console.error("WhatsApp buttons failed, sending text:", err);
    }
  }
  if (!sentText) {
    const sent = await sendWhatsAppText({
      phoneNumberId,
      accessToken,
      to: customerPhone,
      message: params.replyText,
    });
    await storeOutbound({
      businessId: params.businessId,
      conversationId: params.conversationId,
      content: params.replyText,
      messageType: "text",
      whatsappId: sent?.messages?.[0]?.id ?? null,
    });
  }

  const list = skipExtra ? undefined : params.agentResponse.list_menu;
  if (list?.rows?.length) {
    try {
      const sent = await sendWhatsAppList({
        phoneNumberId,
        accessToken,
        to: customerPhone,
        body: list.body,
        button: list.button,
        rows: list.rows,
      });
      await storeOutbound({
        businessId: params.businessId,
        conversationId: params.conversationId,
        content: list.body,
        messageType: "interactive",
        whatsappId: sent?.messages?.[0]?.id ?? null,
      });
    } catch (err) {
      console.error("WhatsApp list failed:", err);
    }
  }

  const publicBase = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const images = skipExtra ? [] : params.agentResponse.send_images || [];
  for (const img of images.slice(0, 10)) {
    const absolute = img.path.startsWith("http") ? img.path : `${publicBase}${img.path}`;
    if (!absolute.startsWith("https://")) continue;
    try {
      const imgSent = await sendWhatsAppImage({
        phoneNumberId,
        accessToken,
        to: customerPhone,
        imageUrl: absolute,
        caption: img.caption,
      });
      await storeOutbound({
        businessId: params.businessId,
        conversationId: params.conversationId,
        content: img.caption,
        messageType: "image",
        whatsappId: imgSent?.messages?.[0]?.id ?? null,
        imageUrl: img.path,
        productName: img.productName || null,
      });
      if (img.seeMore && img.productId) {
        try {
          const more = await sendWhatsAppButtons({
            phoneNumberId,
            accessToken,
            to: customerPhone,
            body: `${img.productName || "Product"} — more details?`,
            buttons: [{ id: `more:${img.productId}`, title: "See more" }],
          });
          await storeOutbound({
            businessId: params.businessId,
            conversationId: params.conversationId,
            content: "See more",
            messageType: "interactive",
            whatsappId: more?.messages?.[0]?.id ?? null,
            productName: img.productName || null,
          });
        } catch (btnErr) {
          console.error("See more button failed:", btnErr);
        }
      }
    } catch (imgErr) {
      console.error("WhatsApp image send failed:", imgErr);
    }
  }
}

function productFromStoredMessage(
  msg: { product_name?: string | null; content: string },
  products: Array<{ name: string; price: number; description?: string; image_url?: string | null }>
) {
  const label = msg.product_name || msg.content.split(" — ")[0];
  if (!label) return null;
  const lower = label.toLowerCase();
  return (
    products.find((p) => p.name.toLowerCase() === lower) ||
    products.find((p) => lower.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(lower)) ||
    null
  );
}

async function resolveReferredProduct(params: {
  conversationId: string;
  contextId?: string;
  text: string;
  products: Array<{ name: string; price: number; description?: string; image_url?: string | null }>;
}) {
  const db = await readDb();
  const convMsgs = db.messages.filter((m) => m.conversation_id === params.conversationId);
  if (params.contextId) {
    const quoted = convMsgs.find((m) => m.whatsapp_message_id === params.contextId);
    if (quoted) {
      const hit = productFromStoredMessage(quoted, params.products);
      if (hit) return hit;
    }
  }
  const lower = params.text.toLowerCase();
  const pointing =
    /\b(yeh?|this|that|isi|usi|wala|wali|wale)\b/.test(lower) || /\d+\s*x\b/.test(lower);
  if (!params.contextId && !pointing) return null;
  const lastCatalog = [...convMsgs]
    .reverse()
    .find(
      (m) =>
        m.direction === "outbound" &&
        (m.message_type === "image" || Boolean(m.product_name) || /Rs\.\d+/.test(m.content))
    );
  return lastCatalog ? productFromStoredMessage(lastCatalog, params.products) : null;
}

async function recordAttention(businessId: string, conversationId: string, phone: string, preview: string) {
  const message = `${phone}: ${preview.slice(0, 180)}`;
  try {
    if (isSupabaseEnabled()) {
      const sb = createAdminClient();
      await sb.from("notifications").insert({
        business_id: businessId,
        title: "Attention required",
        message,
        type: "attention",
        metadata: { conversation_id: conversationId },
      });
      return;
    }
    const db = await readDb();
    db.notifications.push({
      id: uid(),
      business_id: businessId,
      title: "Attention required",
      message,
      type: "attention",
      read: false,
      created_at: nowIso(),
    });
    await writeDb(db);
  } catch (err) {
    console.error("Failed to record attention:", err);
  }
}

async function recordWhatsAppError(businessId: string, message: string) {
  const text = message.slice(0, 500);
  try {
    if (isSupabaseEnabled()) {
      const sb = createAdminClient();
      await sb.from("notifications").insert({
        business_id: businessId,
        title: "WhatsApp send failed",
        message: explainWhatsAppGraphError(text).message,
        type: "error",
      });
      return;
    }
    const db = await readDb();
    db.notifications.push({
      id: uid(),
      business_id: businessId,
      title: "WhatsApp send failed",
      message: explainWhatsAppGraphError(text).message,
      type: "error",
      read: false,
      created_at: nowIso(),
    });
    await writeDb(db);
  } catch (err) {
    console.error("Failed to record WhatsApp error:", err);
  }
}
