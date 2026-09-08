import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { nowIso, readDb, uid, writeDb } from "@/lib/db/store";

async function businessIdForUser() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  return (await readDb()).members.find((m) => m.user_id === userId)?.business_id ?? null;
}

export async function POST(request: NextRequest) {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await request.json();
  const db = await readDb();

  let customer = db.customers.find(
    (c) => c.business_id === businessId && c.phone === form.customerPhone
  );
  if (!customer) {
    customer = {
      id: uid(),
      business_id: businessId,
      name: form.customerName,
      phone: form.customerPhone,
      email: null,
      address: form.address || null,
      notes: form.notes || null,
      whatsapp_id: null,
      total_orders: 0,
      total_spent: 0,
      created_at: nowIso(),
    };
    db.customers.push(customer);
  }

  const qty = parseInt(form.quantity || "1", 10);
  const unit = parseFloat(form.unitPrice || "0");
  const total = parseFloat(form.total) || unit * qty;
  const orderNumber = `ORD-${String(db.orders.filter((o) => o.business_id === businessId).length + 1).padStart(5, "0")}`;
  const orderId = uid();
  db.orders.push({
    id: orderId,
    business_id: businessId,
    order_number: orderNumber,
    customer_id: customer.id,
    subtotal: total,
    discount: 0,
    delivery_fee: 0,
    tax: 0,
    total,
    payment_method: form.paymentMethod || "cod",
    payment_status: "unpaid",
    order_status: "pending",
    delivery_address: form.address || null,
    customer_note: form.notes || null,
    internal_note: null,
    source: "manual",
    whatsapp_conversation_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  if (form.productName) {
    db.order_items.push({
      id: uid(),
      order_id: orderId,
      product_id: null,
      product_name: form.productName,
      quantity: qty,
      unit_price: unit || total,
      variant: null,
    });
  }
  customer.total_orders += 1;
  customer.total_spent += total;
  await writeDb(db);
  return NextResponse.json({ ok: true, id: orderId });
}
