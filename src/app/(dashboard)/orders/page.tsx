import Link from "next/link";
import { requireBusiness } from "@/lib/auth/business";
import { readDb } from "@/lib/db/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { OrderActions } from "./[id]/order-actions";

export default async function OrdersPage() {
  const { businessId, business } = await requireBusiness();
  const db = await readDb();
  const orders = db.orders
    .filter((o) => o.business_id === businessId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

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
          {!orders.length ? (
            <div className="py-16 text-center text-sm text-gray-500">No orders yet</div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">Order #</th>
                  <th className="px-4 py-3 font-medium">Customer / Phone / Address</th>
                  <th className="px-4 py-3 font-medium">Items</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Update</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const customer = db.customers.find((c) => c.id === order.customer_id);
                  const items = db.order_items.filter((i) => i.order_id === order.id);
                  const address = order.delivery_address || customer?.address;
                  return (
                    <tr key={order.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-4">
                        <Link href={`/orders/${order.id}`} className="font-medium text-green-600 hover:underline">
                          {order.order_number}
                        </Link>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-medium text-gray-900">{customer?.name ?? "—"}</p>
                        <p className="text-xs text-gray-500">{customer?.phone || customer?.whatsapp_id || "—"}</p>
                        <p className="max-w-[220px] truncate text-xs text-gray-500">{address || "No address"}</p>
                      </td>
                      <td className="px-4 py-4 text-xs text-gray-600">
                        {items.length
                          ? items.map((i) => `${i.quantity}x ${i.product_name}`).join(", ")
                          : "—"}
                      </td>
                      <td className="px-4 py-4">{formatCurrency(Number(order.total), business.currency)}</td>
                      <td className="px-4 py-4">
                        <StatusBadge status={order.payment_status} />
                        <p className="mt-1 text-xs capitalize text-gray-500">{order.payment_method}</p>
                      </td>
                      <td className="px-4 py-4"><StatusBadge status={order.order_status} /></td>
                      <td className="px-4 py-4">
                        <OrderActions orderId={order.id} currentStatus={order.order_status} compact />
                      </td>
                      <td className="px-4 py-4 text-gray-500">{format(new Date(order.created_at), "MMM d, yyyy")}</td>
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
