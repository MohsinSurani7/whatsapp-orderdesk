"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

export default function NewOrderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    address: "",
    productName: "",
    quantity: "1",
    unitPrice: "",
    total: "",
    paymentMethod: "cod",
    notes: "",
  });

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function createOrder(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: member } = await supabase
      .from("business_members")
      .select("business_id")
      .eq("user_id", user.id)
      .single();

    if (!member) return;

    const { data: customer } = await supabase
      .from("customers")
      .upsert(
        { business_id: member.business_id, name: form.customerName, phone: form.customerPhone, address: form.address },
        { onConflict: "business_id,phone" }
      )
      .select()
      .single();

    if (!customer) { setLoading(false); return; }

    const { count } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("business_id", member.business_id);

    const orderNumber = `ORD-${String((count ?? 0) + 1).padStart(5, "0")}`;
    const total = parseFloat(form.total) || parseFloat(form.unitPrice) * parseInt(form.quantity);

    const { data: order } = await supabase
      .from("orders")
      .insert({
        business_id: member.business_id,
        order_number: orderNumber,
        customer_id: customer.id,
        subtotal: total,
        total,
        payment_method: form.paymentMethod,
        payment_status: "unpaid",
        order_status: "pending",
        delivery_address: form.address,
        customer_note: form.notes,
        source: "manual",
      })
      .select()
      .single();

    if (order && form.productName) {
      await supabase.from("order_items").insert({
        order_id: order.id,
        product_name: form.productName,
        quantity: parseInt(form.quantity),
        unit_price: parseFloat(form.unitPrice) || total,
      });
    }

    router.push("/orders");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Create Order</h1>
      <Card>
        <CardHeader><CardTitle>Order Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={createOrder} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Customer Name *</Label>
                <Input value={form.customerName} onChange={(e) => update("customerName", e.target.value)} required className="mt-1" />
              </div>
              <div>
                <Label>Phone *</Label>
                <Input value={form.customerPhone} onChange={(e) => update("customerPhone", e.target.value)} required className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Delivery Address</Label>
              <Input value={form.address} onChange={(e) => update("address", e.target.value)} className="mt-1" />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label>Product</Label>
                <Input value={form.productName} onChange={(e) => update("productName", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Qty</Label>
                <Input type="number" value={form.quantity} onChange={(e) => update("quantity", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Unit Price</Label>
                <Input type="number" value={form.unitPrice} onChange={(e) => update("unitPrice", e.target.value)} className="mt-1" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Total</Label>
                <Input type="number" value={form.total} onChange={(e) => update("total", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Payment</Label>
                <select value={form.paymentMethod} onChange={(e) => update("paymentMethod", e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm">
                  <option value="cod">COD</option>
                  <option value="cash">Cash</option>
                  <option value="easypaisa">Easypaisa</option>
                  <option value="jazzcash">JazzCash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                </select>
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={form.notes} onChange={(e) => update("notes", e.target.value)} className="mt-1" />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Creating..." : "Create Order"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
