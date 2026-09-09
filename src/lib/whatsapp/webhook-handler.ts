import { processAgentMessage } from "@/lib/ai/agent";
import { transcribeWhatsAppAudio } from "@/lib/ai/transcribe";
import {
  sendWhatsAppText,
  sendWhatsAppImage,
  sendWhatsAppButtons,
  sendWhatsAppList,
  markMessageAsRead,
  downloadWhatsAppMedia,
} from "@/lib/whatsapp/client";
import { resolveWhatsAppAuth } from "@/lib/whatsapp/credentials";
import { isSupabaseEnabled } from "@/lib/db/supabase-sync";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  nowIso,
  readDb,
  resolveWhatsAppConfig,
  uid,
  writeDb,
  type LocalConversation,
} from "@/lib/db/store";
import type { AgentResponse, ParsedOrderData } from "@/types/database";

interface WebhookMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  context?: { id?: string; from?: string };
  image?: { caption?: string; id?: string };
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
        const customerWaName = contacts?.[0]?.profile?.name ?? null;
        let customer = db.customers.find(
          (c) =>
            c.business_id === business.id &&
            (c.phone === customerPhone || c.whatsapp_id === customerPhone)
        );
        if (!customer) {
          customer = {
            id: uid(),
            business_id: business.id,
            name: customerWaName || "WhatsApp Customer",
            phone: customerPhone,
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
            last_message_at: nowIso(),
            created_at: nowIso(),
          };
          db.conversations.push(conversation);
        } else {
          conversation.customer_id = customer.id;
          if (customerWaName) conversation.customer_name = customerWaName;
          if (!agentOn) conversation.status = "handed_off";
        }

        const inboundText = textBody || (msg.context?.id ? "ye product chahiye" : "[message]");
        const voiceOk =
          (msg.type === "audio" || msg.type === "voice") &&
          !/^\[voice (message|failed)/i.test(inboundText.trim());
        const storedInbound = voiceOk ? `🎤 ${inboundText}` : inboundText;

        db.messages.push({
          id: uid(),
          business_id: business.id,
          conversation_id: conversation.id,
          direction: "inbound",
          message_type:
            msg.type === "image"
              ? "image"
              : msg.type === "audio" || msg.type === "voice"
                ? "audio"
                : msg.type === "interactive"
                  ? "interactive"
                  : "text",
          content: storedInbound,
          whatsapp_message_id: msg.id,
          image_url: null,
          created_at: nowIso(),
        });
        conversation.last_message_at = nowIso();
        await writeDb(db);

        if (!agentOn) {
          continue;
        }

        if (!accessToken || !phoneNumberId) {
          await recordWhatsAppError(
            business.id,
            `Token missing — ${customerPhone} ka message save ho gaya. Dashboard → WhatsApp pe token save karke Chats se reply karein.`
          );
          continue;
        }

        const history = db.messages
          .filter((m) => m.conversation_id === conversation!.id)
          .slice(-20)
          .map((m) => ({
            role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
            content: m.content.replace(/^🎤\s*/, ""),
          }));

        const products = db.products
          .filter((p) => p.business_id === business.id && p.is_active)
          .map((p) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            description: p.description || undefined,
            image_url: p.image_url,
            category: p.category,
            sizes: p.sizes,
          }));

        const referredProduct = await resolveReferredProduct({
          conversationId: conversation.id,
          contextId: msg.context?.id,
          text: inboundText,
          products,
        });

        const bizOrders = db.orders.filter((o) => o.business_id === business.id);
        const customerOrders = bizOrders.filter((o) => {
          const c = db.customers.find((cu) => cu.id === o.customer_id);
          return c?.phone === customerPhone || c?.whatsapp_id === customerPhone || o.whatsapp_conversation_id === conversation.id;
        });

        const agentResponse = await processAgentMessage({
          message: inboundText,
          conversationHistory: history,
          businessName: business.name,
          agentName: config.agent_name,
          products,
          pendingOrder: conversation.pending_order_data,
          customerName: conversation.customer_name,
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
          },
        });

        let orderId: string | null = null;
        if (agentResponse.should_create_order && agentResponse.parsed_order) {
          orderId = await createOrderFromAgent(conversation, agentResponse.parsed_order, customerPhone, business.id);
        } else if (agentResponse.parsed_order) {
          const latest = await readDb();
          const conv = latest.conversations.find((c) => c.id === conversation!.id);
          if (conv) {
            conv.pending_order_data = agentResponse.parsed_order as unknown as Record<string, unknown>;
            conv.status = agentResponse.needs_human ? "handed_off" : "awaiting_confirmation";
            conv.last_message_at = nowIso();
            await writeDb(latest);
          }
        } else if (agentResponse.needs_human) {
          const latest = await readDb();
          const conv = latest.conversations.find((c) => c.id === conversation!.id);
          if (conv) {
            conv.status = "handed_off";
            conv.last_message_at = nowIso();
            await writeDb(latest);
          }
        }

        if (agentResponse.needs_human) {
          await recordAttention(business.id, conversation.id, customerPhone, inboundText);
        }

        let replyText = agentResponse.reply;
        if (orderId) {
          const latest = await readDb();
          const order = latest.orders.find((o) => o.id === orderId);
          if (order) {
            replyText += `\n\nOrder #${order.order_number} create ho gaya. Total: Rs.${order.total}`;
          }
        }

        try {
          await sendAgentOutbound({
            phoneNumberId,
            accessToken,
            customerPhone,
            businessId: business.id,
            conversationId: conversation.id,
            replyText,
            agentResponse,
          });
        } catch (error) {
          console.error("WhatsApp send failed:", error);
          await recordWhatsAppError(business.id, String(error));
        }
      }
    }
  }
}

async function resolveInboundText(
  msg: WebhookMessage,
  accessToken: string | null,
  groqKey: string | null
): Promise<{ text: string; category: string | null; seeMoreId: string | null } | null> {
  if (msg.type === "text") {
    const body = msg.text?.body?.trim();
    if (!body) return null;
    return { text: body, category: null, seeMoreId: null };
  }
  if (msg.type === "image") {
    return { text: msg.image?.caption || "[photo]", category: null, seeMoreId: null };
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
      const spoken = await transcribeWhatsAppAudio({
        groqApiKey: groqKey,
        bytes: file.bytes,
        mimeType: msg.audio?.mime_type || msg.voice?.mime_type || file.mimeType,
      });
      if (!spoken) {
        return { text: "[voice failed]", category: null, seeMoreId: null };
      }
      // Prefix helps dashboards; agent still reads the spoken words
      return { text: spoken, category: null, seeMoreId: null };
    } catch (err) {
      console.error("Voice transcribe failed:", err);
      return { text: "[voice failed]", category: null, seeMoreId: null };
    }
  }
  return null;
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
  const buttons = params.agentResponse.quick_replies?.slice(0, 3) || [];
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

  const list = params.agentResponse.list_menu;
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
  for (const img of (params.agentResponse.send_images || []).slice(0, 10)) {
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

async function createOrderFromAgent(
  conversation: LocalConversation,
  orderData: ParsedOrderData,
  customerPhone: string,
  businessId: string
): Promise<string | null> {
  const db = await readDb();
  let customer = conversation.customer_id
    ? db.customers.find((c) => c.id === conversation.customer_id)
    : db.customers.find((c) => c.business_id === businessId && c.phone === (orderData.phone || customerPhone));

  if (!customer) {
    customer = {
      id: uid(),
      business_id: businessId,
      name: orderData.customer_name || conversation.customer_name || "WhatsApp Customer",
      phone: orderData.phone || customerPhone,
      email: null,
      address: orderData.address,
      notes: orderData.notes && !["naam", "address", "payment"].includes(String(orderData.notes)) ? orderData.notes : null,
      whatsapp_id: customerPhone,
      total_orders: 0,
      total_spent: 0,
      created_at: nowIso(),
    };
    db.customers.push(customer);
  } else {
    if (orderData.customer_name) customer.name = orderData.customer_name;
    customer.phone = orderData.phone || customerPhone || customer.phone;
    if (orderData.address) customer.address = orderData.address;
    customer.whatsapp_id = customerPhone;
  }

  const conv = db.conversations.find((c) => c.id === conversation.id);
  if (conv) conv.customer_id = customer.id;

  const count = db.orders.filter((o) => o.business_id === businessId).length;
  const orderNumber = `ORD-${String(count + 1).padStart(5, "0")}`;
  const subtotal =
    orderData.subtotal ??
    orderData.products.reduce((sum, p) => sum + (p.unit_price ?? 0) * p.quantity, 0);
  const total = orderData.total ?? subtotal + (orderData.delivery_fee ?? 0) - (orderData.discount ?? 0);

  const orderId = uid();
  db.orders.push({
    id: orderId,
    business_id: businessId,
    order_number: orderNumber,
    customer_id: customer.id,
    subtotal,
    discount: orderData.discount ?? 0,
    delivery_fee: orderData.delivery_fee ?? 0,
    tax: 0,
    total,
    payment_method: orderData.payment_method ?? "cod",
    payment_status: orderData.payment_status ?? "unpaid",
    order_status: "pending",
    delivery_address: orderData.address || customer.address,
    customer_note: orderData.notes && !["naam", "address", "payment"].includes(String(orderData.notes)) ? orderData.notes : null,
    internal_note: null,
    source: "whatsapp",
    whatsapp_conversation_id: conversation.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  for (const p of orderData.products) {
    db.order_items.push({
      id: uid(),
      order_id: orderId,
      product_id: null,
      product_name: p.name,
      quantity: p.quantity,
      unit_price: p.unit_price ?? 0,
      variant: p.variant,
    });
  }

  customer.total_orders += 1;
  customer.total_spent += total;
  if (conv) {
    conv.pending_order_data = null;
    conv.status = "active";
  }
  db.notifications.push({
    id: uid(),
    business_id: businessId,
    title: "New WhatsApp Order",
    message: `Order ${orderNumber} received via WhatsApp AI agent.`,
    type: "order",
    read: false,
    created_at: nowIso(),
  });
  await writeDb(db);
  return orderId;
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
        message: /expired|190/i.test(text)
          ? "WhatsApp access token expire ho gaya. Meta se naya token banao, Netlify env + WhatsApp settings mein save karo."
          : text,
        type: "error",
      });
      return;
    }
    const db = await readDb();
    db.notifications.push({
      id: uid(),
      business_id: businessId,
      title: "WhatsApp send failed",
      message: text,
      type: "error",
      read: false,
      created_at: nowIso(),
    });
    await writeDb(db);
  } catch (err) {
    console.error("Failed to record WhatsApp error:", err);
  }
}
