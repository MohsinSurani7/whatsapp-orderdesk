import { readDb } from "@/lib/db/store";
import { getSessionUserId } from "@/lib/auth/session";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  const businessId = db.members.find((m) => m.user_id === userId)?.business_id;
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const orders = db.orders.filter((o) => o.business_id === businessId);
  const pendingOrders = orders.filter((o) => o.order_status === "pending" || o.order_status === "processing").length;
  const newOrdersToday = orders.filter((o) => new Date(o.created_at) >= today).length;
  const attentionChats = db.conversations.filter(
    (c) => c.business_id === businessId && c.status === "handed_off"
  ).length;
  const unreadNotifications = db.notifications.filter(
    (n) => n.business_id === businessId && !n.read && (n.type === "attention" || n.type === "order" || n.type === "error")
  ).length;
  const latestAttention = db.notifications
    .filter((n) => n.business_id === businessId && (n.type === "attention" || n.type === "order"))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  return NextResponse.json({
    pendingOrders,
    newOrdersToday,
    attentionChats,
    unreadNotifications,
    latest: latestAttention
      ? { title: latestAttention.title, message: latestAttention.message, type: latestAttention.type, at: latestAttention.created_at }
      : null,
  });
}
