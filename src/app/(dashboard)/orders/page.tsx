import Link from "next/link";
import { requireBusiness } from "@/lib/auth/business";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { Plus } from "lucide-react";

export default async function OrdersPage() {
  const { businessId, business } = await requireBusiness();
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("*, customers(name, phone)")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
          <p className="text-sm text-gray-500">WhatsApp se auto-created aur manual orders</p>
        </div>
        <Link href="/orders/new">
          <Button><Plus size={16} /> New Order</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="p-0">
          {!orders?.length ? (
            <div className="py-16 text-center text-sm text-gray-500">No orders yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-gray-500">
                    <th className="px-6 py-3 font-medium">Order #</th>
                    <th className="px-6 py-3 font-medium">Customer</th>
                    <th className="px-6 py-3 font-medium">Total</th>
                    <th className="px-6 py-3 font-medium">Payment</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                    <th className="px-6 py-3 font-medium">Source</th>
                    <th className="px-6 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const customer = order.customers as { name: string; phone: string } | null;
                    return (
                      <tr key={order.id} className="border-b hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <Link href={`/orders/${order.id}`} className="font-medium text-green-600 hover:underline">
                            {order.order_number}
                          </Link>
                        </td>
                        <td className="px-6 py-4">{customer?.name ?? "—"}</td>
                        <td className="px-6 py-4">{formatCurrency(Number(order.total), business.currency)}</td>
                        <td className="px-6 py-4"><StatusBadge status={order.payment_status} /></td>
                        <td className="px-6 py-4"><StatusBadge status={order.order_status} /></td>
                        <td className="px-6 py-4 capitalize">{order.source}</td>
                        <td className="px-6 py-4 text-gray-500">{format(new Date(order.created_at), "MMM d, yyyy")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
