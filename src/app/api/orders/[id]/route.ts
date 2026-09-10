import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { cancelOrderAndRestock, transitionOrderStatus } from "@/lib/commerce/orders";
import { readDb, writeDb } from "@/lib/db/store";
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
  const member = db.members.find((m) => m.user_id === userId);
  const businessId = member?.business_id;
  const order = db.orders.find((o) => o.id === id && o.business_id === businessId);
  if (!order || !businessId || !member) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (member.role === "staff" && body.payment_status === "paid") {
    return NextResponse.json({ error: "Staff cannot mark orders paid" }, { status: 403 });
  }

  const prevStatus = order.order_status;
  if (body.order_status && body.order_status !== prevStatus) {
    const moved = await transitionOrderStatus({
      orderId: order.id,
      businessId,
      nextStatus: body.order_status,
      actorId: userId,
    });
    if (!moved.ok) {
      return NextResponse.json({ error: moved.code || "INVALID_ORDER_STATE" }, { status: 400 });
    }
  }

  if (body.payment_status) {
    const latest = await readDb();
    const next = latest.orders.find((o) => o.id === id && o.business_id === businessId);
    if (next) {
      next.payment_status = body.payment_status;
      await writeDb(latest);
    }
  }

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
  const member = db.members.find((m) => m.user_id === userId);
  const businessId = member?.business_id;
  if (member?.role === "staff") {
    return NextResponse.json({ error: "Staff cannot delete orders" }, { status: 403 });
  }
  const idx = db.orders.findIndex((o) => o.id === id && o.business_id === businessId);
  if (idx === -1 || !businessId) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const order = db.orders[idx];
  if (order.order_status !== "cancelled" && order.order_status !== "returned") {
    await cancelOrderAndRestock({
      orderId: order.id,
      businessId,
      actorType: "staff",
      actorId: userId,
    });
  }
  const latest = await readDb();
  const customer = latest.customers.find((c) => c.id === order.customer_id);
  if (customer) {
    customer.total_orders = Math.max(0, Number(customer.total_orders) - 1);
  }
  latest.order_items = latest.order_items.filter((i) => i.order_id !== order.id);
  const gone = latest.orders.findIndex((o) => o.id === order.id);
  if (gone >= 0) latest.orders.splice(gone, 1);
  await writeDb(latest);
  return NextResponse.json({ ok: true });
}
