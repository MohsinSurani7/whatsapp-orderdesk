import { processAgentMessage } from "@/lib/ai/agent";
import { sendWhatsAppText, sendWhatsAppImage, markMessageAsRead } from "@/lib/whatsapp/client";
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
import type { ParsedOrderData } from "@/types/database";

interface WebhookMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  context?: { id?: string; from?: string };
  image?: { caption?: string; id?: string };
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
        const textBody =
          msg.type === "text"
            ? msg.text?.body
            : msg.type === "image"
              ? msg.image?.caption || "[photo]"
              : "";
        if (msg.type !== "text" && msg.type !== "image") continue;
        if (msg.type === "text" && !textBody) continue;

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

        db.messages.push({
          id: uid(),
          business_id: business.id,
          conversation_id: conversation.id,
          direction: "inbound",
          message_type: msg.type === "image" ? "image" : "text",
          content: inboundText,
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
            content: m.content,
          }));

        const products = db.products
          .filter((p) => p.business_id === business.id && p.is_active)
          .map((p) => ({
            name: p.name,
            price: p.price,
            description: p.description || undefined,
            image_url: p.image_url,
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
          const sent = await sendWhatsAppText({
            phoneNumberId,
            accessToken,
            to: customerPhone,
            message: replyText,
          });
          const latest = await readDb();
          latest.messages.push({
            id: uid(),
            business_id: business.id,
            conversation_id: conversation.id,
            direction: "outbound",
            message_type: "text",
            content: replyText,
            whatsapp_message_id: sent?.messages?.[0]?.id ?? null,
            image_url: null,
            created_at: nowIso(),
          });
          const conv = latest.conversations.find((c) => c.id === conversation!.id);
          if (conv) conv.last_message_at = nowIso();
          await writeDb(latest);

          const publicBase = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
          const images = agentResponse.send_images || [];
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
              const after = await readDb();
              after.messages.push({
                id: uid(),
                business_id: business.id,
                conversation_id: conversation.id,
                direction: "outbound",
                message_type: "image",
                content: img.caption,
                whatsapp_message_id: imgSent?.messages?.[0]?.id ?? null,
                image_url: img.path,
                product_name: img.productName || img.caption.split(" — ")[0] || null,
                created_at: nowIso(),
              });
              await writeDb(after);
            } catch (imgErr) {
              console.error("WhatsApp image send failed:", imgErr);
            }
          }
        } catch (error) {
          console.error("WhatsApp send failed:", error);
          await recordWhatsAppError(business.id, String(error));
        }
      }
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
