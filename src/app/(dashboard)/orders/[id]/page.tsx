import Link from "next/link";
import { requireBusiness } from "@/lib/auth/business";
import { readDb } from "@/lib/db/store";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { OrderActions } from "./order-actions";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { businessId, business } = await requireBusiness();
  const db = await readDb();
  const order = db.orders.find((o) => o.id === id && o.business_id === businessId);
  if (!order) notFound();
  const customer = db.customers.find((c) => c.id === order.customer_id);
  const items = db.order_items.filter((i) => i.order_id === order.id);
  const address = order.delivery_address || customer?.address || null;
  const phone = customer?.phone || customer?.whatsapp_id || null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/orders" className="text-sm text-green-600 hover:underline">
          ← All orders
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">{order.order_number}</h1>
          <StatusBadge status={order.order_status} />
          <StatusBadge status={order.payment_status} />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {format(new Date(order.created_at), "dd MMM yyyy, h:mm a")} · Source: {order.source}
        </p>
        <div className="mt-4">
          <OrderActions orderId={order.id} currentStatus={order.order_status} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="space-y-2 p-6 text-sm">
            <h3 className="font-semibold text-gray-900">Customer details</h3>
            <p>
              <span className="text-gray-500">Name: </span>
              <span className="font-medium">{customer?.name || "—"}</span>
            </p>
            <p>
              <span className="text-gray-500">Phone / WhatsApp: </span>
              {phone ? (
                <a className="font-medium text-green-700" href={`https://wa.me/${phone.replace(/\D/g, "")}`}>
                  {phone}
                </a>
              ) : (
                "—"
              )}
            </p>
            {customer?.email && (
              <p>
                <span className="text-gray-500">Email: </span>
                {customer.email}
              </p>
            )}
            <p>
              <span className="text-gray-500">Delivery address: </span>
              <span className="whitespace-pre-wrap">{address || "—"}</span>
            </p>
            {order.whatsapp_conversation_id && (
              <Link
                href={`/whatsapp/conversations/${order.whatsapp_conversation_id}`}
                className="inline-block text-green-600 hover:underline"
              >
                WhatsApp chat kholo →
              </Link>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 p-6 text-sm">
            <h3 className="font-semibold text-gray-900">Payment & totals</h3>
            <p className="text-2xl font-bold text-gray-900">
              {formatCurrency(Number(order.total), business.currency)}
            </p>
            <p>
              <span className="text-gray-500">Method: </span>
              <span className="capitalize">{order.payment_method || "—"}</span>
            </p>
            <p>
              <span className="text-gray-500">Payment status: </span>
              {order.payment_status}
            </p>
            <p>
              <span className="text-gray-500">Subtotal: </span>
              {formatCurrency(Number(order.subtotal), business.currency)}
            </p>
            {Number(order.delivery_fee) > 0 && (
              <p>
                <span className="text-gray-500">Delivery: </span>
                {formatCurrency(Number(order.delivery_fee), business.currency)}
              </p>
            )}
            {Number(order.discount) > 0 && (
              <p>
                <span className="text-gray-500">Discount: </span>
                {formatCurrency(Number(order.discount), business.currency)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-6">
          <h3 className="mb-4 font-semibold">Order items</h3>
          {!items.length ? (
            <p className="text-sm text-gray-500">Is order pe items save nahi hue.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {items.map((item) => (
                <div key={item.id} className="flex justify-between border-b py-2 last:border-0">
                  <span>
                    {item.quantity}x {item.product_name}
                    {item.variant ? ` (${item.variant})` : ""}
                    {item.sku ? ` · SKU ${item.sku}` : ""}
                  </span>
                  <span>{formatCurrency(Number(item.unit_price) * item.quantity, business.currency)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {(order.customer_note || order.internal_note) && (
        <Card>
          <CardContent className="space-y-2 p-6 text-sm">
            <h3 className="font-semibold">Notes</h3>
            {order.customer_note && <p>Customer: {order.customer_note}</p>}
            {order.internal_note && <p>Internal: {order.internal_note}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
