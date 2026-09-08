import { envWhatsAppDefaults, nowIso, readDb, uid, writeDb } from "@/lib/db/store";
import { sendWhatsAppText } from "@/lib/whatsapp/client";

const STATUS_COPY: Record<string, string> = {
  pending: "pending / wait kar raha hai",
  confirmed: "confirm ho gaya hai",
  processing: "processing mein hai",
  preparing: "processing / prepare ho raha hai",
  ready: "ready to deliver hai",
  out_for_delivery: "delivery ke liye nikal chuka hai",
  delivered: "deliver ho chuka hai. Shukriya!",
  cancelled: "cancel kar diya gaya hai",
  returned: "return process mein hai",
};

export function orderStatusMessage(params: {
  customerName?: string | null;
  orderNumber: string;
  status: string;
  businessName: string;
}) {
  const state = STATUS_COPY[params.status] || params.status.replace(/_/g, " ");
  const who = params.customerName ? `${params.customerName}, ` : "";
  return `Assalam o Alaikum ${who}aap ke order ${params.orderNumber} ki update: ab status *${state}*. — ${params.businessName}`;
}

export async function notifyCustomerOrderStatus(orderId: string, businessId: string, status: string) {
  const db = await readDb();
  const order = db.orders.find((o) => o.id === orderId && o.business_id === businessId);
  if (!order) return { sent: false, error: "Order not found" };
  const customer = db.customers.find((c) => c.id === order.customer_id);
  const business = db.businesses.find((b) => b.id === businessId);
  const config = db.whatsapp_configs.find((c) => c.business_id === businessId);
  const env = envWhatsAppDefaults();
  const token = process.env.WHATSAPP_ACCESS_TOKEN || env.access_token || config?.access_token;
  const phoneNumberId = config?.phone_number_id || env.phone_number_id;
  const phone = customer?.phone || customer?.whatsapp_id;
  if (!token || !phoneNumberId || !phone || !business) {
    return { sent: false, error: "WhatsApp not configured" };
  }

  const message = orderStatusMessage({
    customerName: customer?.name,
    orderNumber: order.order_number,
    status,
    businessName: business.name,
  });

  try {
    const sent = await sendWhatsAppText({
      phoneNumberId,
      accessToken: token,
      to: phone,
      message,
    });
    if (order.whatsapp_conversation_id) {
      const latest = await readDb();
      latest.messages.push({
        id: uid(),
        business_id: businessId,
        conversation_id: order.whatsapp_conversation_id,
        direction: "outbound",
        message_type: "text",
        content: message,
        whatsapp_message_id: sent?.messages?.[0]?.id ?? null,
        image_url: null,
        created_at: nowIso(),
      });
      await writeDb(latest);
    }
    return { sent: true };
  } catch (error) {
    console.error("Order status WhatsApp notify failed:", error);
    return { sent: false, error: String(error) };
  }
}
