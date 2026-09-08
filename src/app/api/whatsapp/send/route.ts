import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { readDb } from "@/lib/db/store";
import { sendWhatsAppText, renderTemplate, buildWhatsAppLink } from "@/lib/whatsapp/client";

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { orderId, templateKey } = await request.json();
  const db = await readDb();
  const businessId = db.members.find((m) => m.user_id === userId)?.business_id;
  const order = db.orders.find((o) => o.id === orderId && o.business_id === businessId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const customer = db.customers.find((c) => c.id === order.customer_id);
  const business = db.businesses.find((b) => b.id === order.business_id);
  const template = db.templates.find(
    (t) => t.business_id === order.business_id && t.template_key === templateKey
  );
  const config = db.whatsapp_configs.find((c) => c.business_id === order.business_id);

  if (!customer || !business || !template) {
    return NextResponse.json({ error: "Missing order data" }, { status: 404 });
  }

  const message = renderTemplate(template.content, {
    customer_name: customer.name,
    order_number: order.order_number,
    total: order.total,
    currency: business.currency === "PKR" ? "Rs." : business.currency,
    payment_status: order.payment_status,
    business_name: business.name,
  });

  const token = config?.access_token;
  const phoneNumberId = config?.phone_number_id;
  if (token && phoneNumberId) {
    await sendWhatsAppText({
      phoneNumberId,
      accessToken: token,
      to: customer.phone,
      message,
    });
    return NextResponse.json({ success: true, method: "api" });
  }

  return NextResponse.json({
    success: true,
    method: "link",
    link: buildWhatsAppLink(customer.phone, message),
  });
}
