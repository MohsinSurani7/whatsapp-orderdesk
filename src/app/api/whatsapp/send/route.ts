import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendWhatsAppText, renderTemplate } from "@/lib/whatsapp/client";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { orderId, templateKey } = await request.json();

  const { data: order } = await supabase
    .from("orders")
    .select("*, customers(*), businesses(*)")
    .eq("id", orderId)
    .single();

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const { data: config } = await supabase
    .from("whatsapp_configs")
    .select("*")
    .eq("business_id", order.business_id)
    .single();

  const { data: template } = await supabase
    .from("whatsapp_templates")
    .select("*")
    .eq("business_id", order.business_id)
    .eq("template_key", templateKey)
    .single();

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const customer = order.customers as { name: string; phone: string };
  const business = order.businesses as { name: string; currency: string };

  const message = renderTemplate(template.content, {
    customer_name: customer.name,
    order_number: order.order_number,
    total: order.total,
    currency: business.currency === "PKR" ? "Rs." : business.currency,
    payment_status: order.payment_status,
    business_name: business.name,
  });

  if (config?.access_token && config.phone_number_id) {
    await sendWhatsAppText({
      phoneNumberId: config.phone_number_id,
      accessToken: config.access_token,
      to: customer.phone,
      message,
    });
    return NextResponse.json({ success: true, method: "api" });
  }

  const { buildWhatsAppLink } = await import("@/lib/whatsapp/client");
  const link = buildWhatsAppLink(customer.phone, message);
  return NextResponse.json({ success: true, method: "link", link });
}
