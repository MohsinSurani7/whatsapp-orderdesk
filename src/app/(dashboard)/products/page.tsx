"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { Plus, ImageIcon, Pencil, Trash2, X, Link2 } from "lucide-react";

type Product = {
  id: string;
  name: string;
  price: number;
  sku: string | null;
  stock: number | null;
  description: string | null;
  image_url: string | null;
  category: string | null;
  sizes: string | null;
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/products");
    const data = await res.json();
    setProducts(data.products ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function saveProduct(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const form = e.currentTarget;
    const body = new FormData(form);
    if (editing) {
      await fetch(`/api/products/${editing.id}`, { method: "PATCH", body });
    } else {
      await fetch("/api/products", { method: "POST", body });
    }
    form.reset();
    setShowForm(false);
    setEditing(null);
    setSaving(false);
    load();
  }

  async function deleteProduct(id: string) {
    if (!confirm("Yeh product delete ho jayega. Confirm?")) return;
    await fetch(`/api/products/${id}`, { method: "DELETE" });
    load();
  }

  function startEdit(p: Product) {
    setEditing(p);
    setShowForm(true);
  }

  async function importFromWebsite() {
    const url = importUrl.trim();
    if (!url) return;
    setImporting(true);
    setImportMsg(null);
    const res = await fetch("/api/products/import-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    setImporting(false);
    if (!res.ok) {
      setImportMsg(data.error || "Import fail ho gaya");
      return;
    }
    setImportMsg(
      `${data.added || 0} products add hue` +
        (data.found != null ? ` (${data.found} page se mile)` : "") +
        (data.skipped ? `, ${data.skipped} skip (pehle se the)` : "") +
        (data.note ? `. ${data.note}` : "")
    );
    setImportUrl("");
    load();
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500">
            Manual add, ya apni website ka products page link paste karke Groq se auto-import.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setShowForm(!showForm);
          }}
          className="w-full sm:w-auto"
        >
          <Plus size={16} /> Add Product
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 size={18} /> Import from website link
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-600">
            Apni shop/products page ka URL dein. System name + price + description + photo ko same product card se
            match karta hai — galat mix avoid. Agar photo unsure ho to blank chhor deta hai (Edit se add kar lo).
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="https://yourshop.com/products"
              className="flex-1"
            />
            <Button type="button" disabled={importing || importUrl.trim().length < 8} onClick={importFromWebsite}>
              {importing ? "Importing..." : "Fetch & add"}
            </Button>
          </div>
          {importMsg && <p className="text-sm text-gray-700">{importMsg}</p>}
          <p className="text-xs text-gray-500">
            Best: catalog/shop page. Multi-page catalog ho to har page alag import karo (duplicates skip). Import ke
            baad jaldi se photos/prices dekh lo — Edit se easily fix ho jata hai.
          </p>
        </CardContent>
      </Card>

      {showForm && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{editing ? "Edit Product" : "New Product"}</CardTitle>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditing(null);
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              <X size={18} />
            </button>
          </CardHeader>
          <CardContent>
            <form key={editing?.id || "new"} onSubmit={saveProduct} className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Photo</Label>
                <Input name="image" type="file" accept="image/*" className="mt-1" />
                {editing?.image_url && (
                  <p className="mt-1 text-xs text-gray-500">Nayi photo choose karo tabhi replace hogi</p>
                )}
              </div>
              <div>
                <Label>Name *</Label>
                <Input name="name" required className="mt-1" defaultValue={editing?.name ?? ""} placeholder="Cotton Suit" />
              </div>
              <div>
                <Label>Price (PKR) *</Label>
                <Input
                  name="price"
                  type="number"
                  required
                  className="mt-1"
                  defaultValue={editing?.price ?? ""}
                  placeholder="10000"
                />
              </div>
              <div>
                <Label>SKU</Label>
                <Input name="sku" className="mt-1" defaultValue={editing?.sku ?? ""} />
              </div>
              <div>
                <Label>Stock</Label>
                <Input name="stock" type="number" className="mt-1" defaultValue={editing?.stock ?? ""} />
              </div>
              <div>
                <Label>Category</Label>
                <Input
                  name="category"
                  className="mt-1"
                  defaultValue={editing?.category ?? ""}
                  placeholder="Shoes, Suits, Bags"
                />
              </div>
              <div>
                <Label>Sizes</Label>
                <Input
                  name="sizes"
                  className="mt-1"
                  defaultValue={editing?.sizes ?? ""}
                  placeholder="1-10 or 6,7,8,9 or S,M,L"
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Description</Label>
                <Input
                  name="description"
                  className="mt-1"
                  defaultValue={editing?.description ?? ""}
                  placeholder="Cotton, unstitched, 3 piece"
                />
              </div>
              <Button type="submit" disabled={saving} className="sm:col-span-2">
                {saving ? "Saving..." : editing ? "Update Product" : "Save Product"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <Card key={p.id} className="overflow-hidden">
            <div className="aspect-[4/3] bg-gray-100">
              {p.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-gray-400">
                  <ImageIcon size={32} />
                </div>
              )}
            </div>
            <CardContent className="p-4">
              <p className="font-medium">{p.name}</p>
              {p.category && <p className="text-xs font-medium text-gray-500">{p.category}</p>}
              <p className="text-lg font-bold text-green-600">{formatCurrency(Number(p.price))}</p>
              {p.sizes && <p className="mt-1 text-xs text-gray-500">Sizes: {p.sizes}</p>}
              {p.description && <p className="mt-1 text-xs text-gray-500">{p.description}</p>}
              {p.stock != null && <p className="text-xs text-gray-500">Stock: {p.stock}</p>}
              <div className="mt-3 flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => startEdit(p)}>
                  <Pencil size={14} /> Edit
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => deleteProduct(p.id)}>
                  <Trash2 size={14} /> Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {!products.length && (
          <Card className="col-span-full">
            <CardContent className="py-12 text-center text-sm text-gray-500">
              Abhi koi product nahi. Upar website link se import karo, ya Add Product dabao.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
