"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NewOrderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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
    setError("");
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not create order");
      setLoading(false);
      return;
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
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Creating..." : "Create Order"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
