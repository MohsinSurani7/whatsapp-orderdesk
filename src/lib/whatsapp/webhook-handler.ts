import { createAdminClient } from "@/lib/supabase/admin";
import { processAgentMessage } from "@/lib/ai/agent";
import { sendWhatsAppText, markMessageAsRead } from "@/lib/whatsapp/client";
import type { ParsedOrderData, WhatsAppConfig, Business } from "@/types/database";

interface WebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

interface WebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: { display_phone_number: string; phone_number_id: string };
      contacts?: Array<{ profile: { name: string }; wa_id: string }>;
      messages?: WebhookMessage[];
    };
    field: string;
  }>;
}

export async function handleWhatsAppWebhook(body: { entry?: WebhookEntry[] }) {
  const supabase = createAdminClient();

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;

      const { metadata, messages, contacts } = change.value;
      if (!messages?.length) continue;

      const phoneNumberId = metadata.phone_number_id;

      const { data: config } = await supabase
        .from("whatsapp_configs")
        .select("*, businesses(*)")
        .eq("phone_number_id", phoneNumberId)
        .single();

      if (!config || !config.agent_enabled) continue;

      const business = config.businesses as unknown as Business;
      const waConfig = config as WhatsAppConfig & { businesses: Business };

      for (const msg of messages) {
        if (msg.type !== "text" || !msg.text?.body) continue;

        await markMessageAsRead(phoneNumberId, waConfig.access_token!, msg.id);

        const customerPhone = msg.from;
        const customerWaName = contacts?.[0]?.profile?.name ?? null;
        const inboundText = msg.text.body;

        const conversation = await getOrCreateConversation(
          supabase,
          waConfig.business_id,
          customerPhone,
          customerWaName
        );

        await supabase.from("whatsapp_messages").insert({
          business_id: waConfig.business_id,
          conversation_id: conversation.id,
          direction: "inbound",
          message_type: "text",
          content: inboundText,
          whatsapp_message_id: msg.id,
        });

        const { data: history } = await supabase
          .from("whatsapp_messages")
          .select("direction, content")
          .eq("conversation_id", conversation.id)
          .order("created_at", { ascending: true })
          .limit(20);

        const conversationHistory = (history ?? []).map((m) => ({
          role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
          content: m.content,
        }));

        const { data: products } = await supabase
          .from("products")
          .select("name, price")
          .eq("business_id", waConfig.business_id)
          .eq("is_active", true)
          .limit(50);

        const agentResponse = await processAgentMessage({
          message: inboundText,
          conversationHistory,
          businessName: business.name,
          agentName: waConfig.agent_name,
          products: products ?? [],
          pendingOrder: conversation.pending_order_data,
          customerName: conversation.customer_name,
        });

        let orderId: string | null = null;

        if (agentResponse.should_create_order && agentResponse.parsed_order) {
          orderId = await createOrderFromAgent(
            supabase,
            waConfig.business_id,
            conversation,
            agentResponse.parsed_order,
            customerPhone
          );
        } else if (agentResponse.parsed_order) {
          await supabase
            .from("whatsapp_conversations")
            .update({
              pending_order_data: agentResponse.parsed_order,
              status: "awaiting_confirmation",
              last_message_at: new Date().toISOString(),
            })
            .eq("id", conversation.id);
        }

        if (agentResponse.needs_human) {
          await supabase
            .from("whatsapp_conversations")
            .update({ status: "handed_off" })
            .eq("id", conversation.id);

          await supabase.from("notifications").insert({
            business_id: waConfig.business_id,
            title: "Human handoff needed",
            message: `Customer ${customerPhone} needs human assistance.`,
            type: "warning",
          });
        }

        let replyText = agentResponse.reply;
        if (orderId) {
          const { data: order } = await supabase
            .from("orders")
            .select("order_number, total")
            .eq("id", orderId)
            .single();
          if (order) {
            replyText += `\n\nOrder #${order.order_number} create ho gaya. Total: Rs.${order.total}`;
          }
        }

        if (waConfig.access_token && waConfig.phone_number_id) {
          const sent = await sendWhatsAppText({
            phoneNumberId: waConfig.phone_number_id,
            accessToken: waConfig.access_token,
            to: customerPhone,
            message: replyText,
          });

          await supabase.from("whatsapp_messages").insert({
            business_id: waConfig.business_id,
            conversation_id: conversation.id,
            direction: "outbound",
            message_type: "text",
            content: replyText,
            whatsapp_message_id: sent?.messages?.[0]?.id ?? null,
          });
        }

        await supabase
          .from("whatsapp_conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", conversation.id);
      }
    }
  }
}

async function getOrCreateConversation(
  supabase: ReturnType<typeof createAdminClient>,
  businessId: string,
  customerPhone: string,
  customerName: string | null
) {
  const { data: existing } = await supabase
    .from("whatsapp_conversations")
    .select("*")
    .eq("business_id", businessId)
    .eq("customer_phone", customerPhone)
    .single();

  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("whatsapp_conversations")
    .insert({
      business_id: businessId,
      customer_phone: customerPhone,
      customer_name: customerName,
      status: "active",
    })
    .select()
    .single();

  if (error) throw error;
  return created;
}

async function createOrderFromAgent(
  supabase: ReturnType<typeof createAdminClient>,
  businessId: string,
  conversation: { id: string; customer_id: string | null; customer_name: string | null },
  orderData: ParsedOrderData,
  customerPhone: string
): Promise<string | null> {
  let customerId = conversation.customer_id;

  if (!customerId) {
    const { data: customer } = await supabase
      .from("customers")
      .upsert(
        {
          business_id: businessId,
          name: orderData.customer_name || conversation.customer_name || "WhatsApp Customer",
          phone: orderData.phone || customerPhone,
          address: orderData.address,
          whatsapp_id: customerPhone,
        },
        { onConflict: "business_id,phone" }
      )
      .select()
      .single();

    customerId = customer?.id ?? null;

    if (customerId) {
      await supabase
        .from("whatsapp_conversations")
        .update({ customer_id: customerId })
        .eq("id", conversation.id);
    }
  }

  if (!customerId) return null;

  const { count } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("business_id", businessId);

  const orderNumber = `ORD-${String((count ?? 0) + 1).padStart(5, "0")}`;

  const subtotal =
    orderData.subtotal ??
    orderData.products.reduce(
      (sum, p) => sum + (p.unit_price ?? 0) * p.quantity,
      0
    );
  const total = orderData.total ?? subtotal + (orderData.delivery_fee ?? 0) - (orderData.discount ?? 0);

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      business_id: businessId,
      order_number: orderNumber,
      customer_id: customerId,
      subtotal,
      discount: orderData.discount ?? 0,
      delivery_fee: orderData.delivery_fee ?? 0,
      tax: 0,
      total,
      payment_method: orderData.payment_method ?? "cod",
      payment_status: orderData.payment_status ?? "unpaid",
      order_status: "pending",
      delivery_address: orderData.address,
      customer_note: orderData.notes,
      source: "whatsapp",
      whatsapp_conversation_id: conversation.id,
    })
    .select()
    .single();

  if (error || !order) return null;

  if (orderData.products.length) {
    await supabase.from("order_items").insert(
      orderData.products.map((p) => ({
        order_id: order.id,
        product_name: p.name,
        quantity: p.quantity,
        unit_price: p.unit_price ?? 0,
        variant: p.variant,
      }))
    );
  }

  await supabase
    .from("whatsapp_conversations")
    .update({
      pending_order_data: null,
      status: "active",
    })
    .eq("id", conversation.id);

  await supabase.from("notifications").insert({
    business_id: businessId,
    title: "New WhatsApp Order",
    message: `Order ${orderNumber} received via WhatsApp AI agent.`,
    type: "order",
    metadata: { order_id: order.id },
  });

  return order.id;
}
