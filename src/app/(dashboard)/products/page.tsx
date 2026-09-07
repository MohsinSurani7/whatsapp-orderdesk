"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { Plus } from "lucide-react";

export default function ProductsPage() {
  const [products, setProducts] = useState<Array<Record<string, unknown>>>([]);
  const [businessId, setBusinessId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", price: "", sku: "", stock: "" });

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: member } = await supabase.from("business_members").select("business_id").eq("user_id", user.id).single();
      if (!member) return;
      setBusinessId(member.business_id);
      const { data } = await supabase.from("products").select("*").eq("business_id", member.business_id).order("created_at", { ascending: false });
      setProducts(data ?? []);
    }
    load();
  }, []);

  async function addProduct(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    await supabase.from("products").insert({
      business_id: businessId,
      name: form.name,
      price: parseFloat(form.price),
      sku: form.sku || null,
      stock: form.stock ? parseInt(form.stock) : null,
    });
    setShowForm(false);
    setForm({ name: "", price: "", sku: "", stock: "" });
    const { data } = await supabase.from("products").select("*").eq("business_id", businessId);
    setProducts(data ?? []);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500">AI agent in products ko WhatsApp pe suggest karega</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}><Plus size={16} /> Add Product</Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle>New Product</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={addProduct} className="grid gap-4 sm:grid-cols-2">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="mt-1" /></div>
              <div><Label>Price</Label><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required className="mt-1" /></div>
              <div><Label>SKU</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="mt-1" /></div>
              <div><Label>Stock</Label><Input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className="mt-1" /></div>
              <Button type="submit" className="sm:col-span-2">Save Product</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <Card key={String(p.id)}>
            <CardContent className="p-4">
              <p className="font-medium">{String(p.name)}</p>
              <p className="text-lg font-bold text-green-600">{formatCurrency(Number(p.price))}</p>
              {p.stock != null && <p className="text-xs text-gray-500">Stock: {String(p.stock)}</p>}
            </CardContent>
          </Card>
        ))}
        {!products.length && (
          <Card className="col-span-full">
            <CardContent className="py-12 text-center text-sm text-gray-500">No products yet. Add products so AI agent can suggest them in WhatsApp chats.</CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
