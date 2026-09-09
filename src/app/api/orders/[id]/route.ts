import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { nowIso, readDb, writeDb } from "@/lib/db/store";
import { notifyCustomerOrderStatus } from "@/lib/whatsapp/notify-order";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json();
  const db = await readDb();
  const businessId = db.members.find((m) => m.user_id === userId)?.business_id;
  const order = db.orders.find((o) => o.id === id && o.business_id === businessId);
  if (!order || !businessId) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const prevStatus = order.order_status;
  if (body.order_status) order.order_status = body.order_status;
  if (body.payment_status) order.payment_status = body.payment_status;
  order.updated_at = nowIso();

  if (body.order_status && body.order_status !== prevStatus) {
    const customer = db.customers.find((c) => c.id === order.customer_id);
    const cancelledNow = body.order_status === "cancelled" || body.order_status === "returned";
    const wasCancelled = prevStatus === "cancelled" || prevStatus === "returned";
    if (customer && cancelledNow && !wasCancelled) {
      customer.total_spent = Math.max(0, Number(customer.total_spent) - Number(order.total));
    }
  }
  await writeDb(db);

  let notified = false;
  if (body.order_status && body.order_status !== prevStatus) {
    const result = await notifyCustomerOrderStatus(order.id, businessId, body.order_status);
    notified = result.sent;
  }

  return NextResponse.json({ ok: true, notified });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = await readDb();
  const businessId = db.members.find((m) => m.user_id === userId)?.business_id;
  const idx = db.orders.findIndex((o) => o.id === id && o.business_id === businessId);
  if (idx === -1 || !businessId) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const order = db.orders[idx];
  const customer = db.customers.find((c) => c.id === order.customer_id);
  if (customer && order.order_status !== "cancelled" && order.order_status !== "returned") {
    customer.total_spent = Math.max(0, Number(customer.total_spent) - Number(order.total));
    customer.total_orders = Math.max(0, Number(customer.total_orders) - 1);
  }
  db.order_items = db.order_items.filter((i) => i.order_id !== order.id);
  db.orders.splice(idx, 1);
  await writeDb(db);
  return NextResponse.json({ ok: true });
}
