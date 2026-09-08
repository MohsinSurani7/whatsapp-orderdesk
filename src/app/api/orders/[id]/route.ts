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
  await writeDb(db);

  let notified = false;
  if (body.order_status && body.order_status !== prevStatus) {
    const result = await notifyCustomerOrderStatus(order.id, businessId, body.order_status);
    notified = result.sent;
  }

  return NextResponse.json({ ok: true, notified });
}
