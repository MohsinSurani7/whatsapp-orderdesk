import { requireBusiness } from "@/lib/auth/business";
import { readDb } from "@/lib/db/store";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { notFound } from "next/navigation";
import { OrderActions } from "./order-actions";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { businessId, business } = await requireBusiness();
  const db = await readDb();
  const order = db.orders.find((o) => o.id === id && o.business_id === businessId);
  if (!order) notFound();
  const customer = db.customers.find((c) => c.id === order.customer_id);
  const items = db.order_items.filter((i) => i.order_id === order.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{order.order_number}</h1>
        <p className="text-sm text-gray-500 capitalize">Source: {order.source}</p>
        <p className="mt-1 text-xs text-gray-500">Status change pe customer ko WhatsApp pe auto message jata hai</p>
        <div className="mt-4">
          <OrderActions orderId={order.id} currentStatus={order.order_status} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="space-y-2 p-6">
            <h3 className="font-semibold">Customer</h3>
            <p>{customer?.name}</p>
            <p className="text-sm text-gray-500">{customer?.phone}</p>
            {customer?.address && <p className="text-sm text-gray-500">{customer.address}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 p-6">
            <h3 className="font-semibold">Payment</h3>
            <p className="text-2xl font-bold">{formatCurrency(Number(order.total), business.currency)}</p>
            <p className="text-sm capitalize text-gray-500">{order.payment_method} — {order.payment_status}</p>
          </CardContent>
        </Card>
      </div>
      {items.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <h3 className="mb-4 font-semibold">Items</h3>
            {items.map((item) => (
              <div key={item.id} className="flex justify-between border-b py-2 last:border-0">
                <span>{item.quantity}x {item.product_name}</span>
                <span>{formatCurrency(Number(item.unit_price) * item.quantity, business.currency)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
