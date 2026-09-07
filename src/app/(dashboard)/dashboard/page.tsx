import Link from "next/link";
import { requireBusiness } from "@/lib/auth/business";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { Bot, MessageCircle, Plus, ShoppingBag, Users, TrendingUp } from "lucide-react";
import { format } from "date-fns";

export default async function DashboardPage() {
  const { businessId, business } = await requireBusiness();
  const supabase = await createClient();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    { count: ordersToday },
    { count: pendingOrders },
    { count: unpaidOrders },
    { count: totalCustomers },
    { data: recentOrders },
    { data: waConfig },
    { count: activeConversations },
  ] = await Promise.all([
    supabase.from("orders").select("*", { count: "exact", head: true }).eq("business_id", businessId).gte("created_at", today.toISOString()),
    supabase.from("orders").select("*", { count: "exact", head: true }).eq("business_id", businessId).eq("order_status", "pending"),
    supabase.from("orders").select("*", { count: "exact", head: true }).eq("business_id", businessId).eq("payment_status", "unpaid"),
    supabase.from("customers").select("*", { count: "exact", head: true }).eq("business_id", businessId),
    supabase.from("orders").select("*, customers(name, phone)").eq("business_id", businessId).order("created_at", { ascending: false }).limit(5),
    supabase.from("whatsapp_configs").select("agent_enabled, phone_number_id").eq("business_id", businessId).single(),
    supabase.from("whatsapp_conversations").select("*", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "active"),
  ]);

  const { data: salesData } = await supabase
    .from("orders")
    .select("total")
    .eq("business_id", businessId)
    .gte("created_at", today.toISOString());

  const todaySales = salesData?.reduce((sum, o) => sum + Number(o.total), 0) ?? 0;

  const stats = [
    { label: "Today's Sales", value: formatCurrency(todaySales, business.currency), icon: TrendingUp, color: "text-green-600" },
    { label: "Orders Today", value: ordersToday ?? 0, icon: ShoppingBag, color: "text-blue-600" },
    { label: "Pending Orders", value: pendingOrders ?? 0, icon: ShoppingBag, color: "text-yellow-600" },
    { label: "Active Chats", value: activeConversations ?? 0, icon: MessageCircle, color: "text-green-600" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">Welcome back, {business.name}</p>
        </div>
        <div className="flex gap-3">
          <Link href="/orders/new">
            <Button><Plus size={16} /> Create Order</Button>
          </Link>
        </div>
      </div>

      {/* WhatsApp Agent Status */}
      <Card className="border-green-200 bg-green-50">
        <CardContent className="flex items-center gap-4 p-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-600">
            <Bot className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-green-900">WhatsApp AI Agent</p>
            <p className="text-sm text-green-700">
              {waConfig?.agent_enabled
                ? waConfig.phone_number_id
                  ? "Active — automatically managing WhatsApp chats"
                  : "Enabled — connect WhatsApp API to go live"
                : "Disabled — enable in WhatsApp settings"}
            </p>
          </div>
          <Link href="/whatsapp">
            <Button variant="outline" size="sm">Configure</Button>
          </Link>
        </CardContent>
      </Card>

      {/* Stats */}
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

      {/* Recent Orders */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Orders</CardTitle>
          <Link href="/orders" className="text-sm text-green-600 hover:text-green-700">View all</Link>
        </CardHeader>
        <CardContent>
          {!recentOrders?.length ? (
            <div className="py-12 text-center">
              <ShoppingBag className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">No orders yet</p>
              <p className="text-xs text-gray-400">Orders will appear here when customers message on WhatsApp</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
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
                    const customer = order.customers as { name: string; phone: string } | null;
                    return (
                      <tr key={order.id} className="border-b last:border-0">
                        <td className="py-3">
                          <Link href={`/orders/${order.id}`} className="font-medium text-green-600 hover:underline">
                            {order.order_number}
                          </Link>
                          {order.source === "whatsapp" && (
                            <span className="ml-2 text-xs text-green-500">via WhatsApp</span>
                          )}
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick stats row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Users size={20} className="text-gray-400" />
            <div>
              <p className="text-sm text-gray-500">Total Customers</p>
              <p className="text-xl font-bold">{totalCustomers ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <ShoppingBag size={20} className="text-gray-400" />
            <div>
              <p className="text-sm text-gray-500">Unpaid Orders</p>
              <p className="text-xl font-bold">{unpaidOrders ?? 0}</p>
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
