import Link from "next/link";
import { requireBusiness } from "@/lib/auth/business";
import { readDb } from "@/lib/db/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { inspectWhatsAppToken, resolveWhatsAppAuth } from "@/lib/whatsapp/credentials";
import { Bot, MessageCircle, Plus, ShoppingBag, Users, TrendingUp } from "lucide-react";
import { format } from "date-fns";

export default async function DashboardPage() {
  const { businessId, business } = await requireBusiness();
  const db = await readDb();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const orders = db.orders.filter((o) => o.business_id === businessId);
  const ordersToday = orders.filter((o) => new Date(o.created_at) >= today);
  const pendingOrders = orders.filter((o) => o.order_status === "pending").length;
  const unpaidOrders = orders.filter((o) => o.payment_status === "unpaid").length;
  const totalCustomers = db.customers.filter((c) => c.business_id === businessId).length;
  const recentOrders = [...orders].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
  const waConfig = db.whatsapp_configs.find((c) => c.business_id === businessId);
  const waAuth = resolveWhatsAppAuth(waConfig);
  const waHealth = await inspectWhatsAppToken(waAuth.accessToken, waAuth.phoneNumberId);
  const activeConversations = db.conversations.filter(
    (c) => c.business_id === businessId && c.status === "active"
  ).length;
  const todaySales = ordersToday.reduce((sum, o) => sum + Number(o.total), 0);
  const attention = db.notifications
    .filter((n) => n.business_id === businessId && !n.read && (n.type === "attention" || n.type === "error"))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6);
  const needsYou = db.conversations.filter((c) => c.business_id === businessId && c.status === "handed_off");

  const stats = [
    { label: "Today's Sales", value: formatCurrency(todaySales, business.currency), icon: TrendingUp, color: "text-green-600" },
    { label: "Orders Today", value: ordersToday.length, icon: ShoppingBag, color: "text-blue-600" },
    { label: "Pending Orders", value: pendingOrders, icon: ShoppingBag, color: "text-yellow-600" },
    { label: "Active Chats", value: activeConversations, icon: MessageCircle, color: "text-green-600" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">Welcome back, {business.name}</p>
        </div>
        <Link href="/orders/new">
          <Button><Plus size={16} /> Create Order</Button>
        </Link>
      </div>

      {(attention.length > 0 || needsYou.length > 0) && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="space-y-2 p-4">
            <p className="font-semibold text-amber-900">Attention required</p>
            <p className="text-sm text-amber-800">
              {needsYou.length
                ? `${needsYou.length} chat mein agent ko human help chahiye.`
                : "Agent ne unusual / complaint message flag kiya."}
            </p>
            <ul className="space-y-1 text-sm text-amber-900">
              {attention.slice(0, 4).map((n) => (
                <li key={n.id}>• {n.title}: {n.message}</li>
              ))}
            </ul>
            <Link href="/whatsapp/conversations" className="inline-block text-sm font-medium text-amber-900 underline">
              Chats kholo
            </Link>
          </CardContent>
        </Card>
      )}

      <Card className={waHealth.ok ? "border-green-200 bg-green-50" : "border-red-300 bg-red-50"}>
        <CardContent className="flex items-center gap-4 p-4">
          <div className={`flex h-12 w-12 items-center justify-center rounded-full ${waHealth.ok ? "bg-green-600" : "bg-red-600"}`}>
            <Bot className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <p className={`font-semibold ${waHealth.ok ? "text-green-900" : "text-red-900"}`}>WhatsApp AI Agent</p>
            <p className={`text-sm ${waHealth.ok ? "text-green-700" : "text-red-700"}`}>
              {waHealth.ok
                ? waConfig?.agent_enabled
                  ? "Active — WhatsApp token valid, agent replies kar sakta hai"
                  : "Token valid hai lekin agent disabled hai"
                : waHealth.message}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Link href="/whatsapp/conversations">
              <Button variant="outline" size="sm">Chats</Button>
            </Link>
            <Link href="/whatsapp">
              <Button variant="outline" size="sm">Configure</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-4 p-6">
              <div className={`rounded-lg bg-gray-50 p-3 ${color}`}>
                <Icon size={20} />
              </div>
              <div>
                <p className="text-sm text-gray-500">{label}</p>
                <p className="text-2xl font-bold text-gray-900">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Orders</CardTitle>
          <Link href="/orders" className="text-sm text-green-600 hover:text-green-700">View all</Link>
        </CardHeader>
        <CardContent>
          {!recentOrders.length ? (
            <div className="py-12 text-center">
              <ShoppingBag className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">No orders yet</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-3 font-medium">Order</th>
                  <th className="pb-3 font-medium">Customer</th>
                  <th className="pb-3 font-medium">Amount</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => {
                  const customer = db.customers.find((c) => c.id === order.customer_id);
                  return (
                    <tr key={order.id} className="border-b last:border-0">
                      <td className="py-3">
                        <Link href={`/orders/${order.id}`} className="font-medium text-green-600 hover:underline">
                          {order.order_number}
                        </Link>
                      </td>
                      <td className="py-3">{customer?.name ?? "—"}</td>
                      <td className="py-3">{formatCurrency(Number(order.total), business.currency)}</td>
                      <td className="py-3"><StatusBadge status={order.order_status} /></td>
                      <td className="py-3 text-gray-500">{format(new Date(order.created_at), "MMM d, h:mm a")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Users size={20} className="text-gray-400" />
            <div>
              <p className="text-sm text-gray-500">Total Customers</p>
              <p className="text-xl font-bold">{totalCustomers}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <ShoppingBag size={20} className="text-gray-400" />
            <div>
              <p className="text-sm text-gray-500">Unpaid Orders</p>
              <p className="text-xl font-bold">{unpaidOrders}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <MessageCircle size={20} className="text-gray-400" />
            <div>
              <p className="text-sm text-gray-500">WhatsApp Source</p>
              <p className="text-xl font-bold">Auto</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
