import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getSessionUserId } from "@/lib/auth/session";
import { readDb, uid, writeDb } from "@/lib/db/store";
import { isSupabaseEnabled, uploadProductImage } from "@/lib/db/supabase-sync";

async function businessIdForUser() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const db = await readDb();
  return db.members.find((m) => m.user_id === userId)?.business_id ?? null;
}

async function saveImage(file: File) {
  const ext = path.extname(file.name).toLowerCase() || ".jpg";
  const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
  const filename = `${uid()}${safeExt}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  if (isSupabaseEnabled()) {
    return uploadProductImage(filename, bytes, file.type || "image/jpeg");
  }
  const dir = path.join(process.cwd(), "public", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), bytes);
  return `/uploads/${filename}`;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = await readDb();
  const product = db.products.find((p) => p.id === id && p.business_id === businessId);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await request.formData();
  const name = form.get("name");
  const price = form.get("price");
  const sku = form.get("sku");
  const stock = form.get("stock");
  const description = form.get("description");
  const category = form.get("category");
  const sizes = form.get("sizes");
  const file = form.get("image");

  if (typeof name === "string" && name.trim()) product.name = name.trim();
  if (typeof price === "string" && price) product.price = parseFloat(price);
  if (sku !== null) product.sku = String(sku) || null;
  if (stock !== null) product.stock = String(stock) ? parseInt(String(stock), 10) : null;
  if (description !== null) product.description = String(description) || null;
  if (category !== null) product.category = String(category) || null;
  if (sizes !== null) product.sizes = String(sizes) || null;

  if (file instanceof File && file.size > 0) {
    product.image_url = await saveImage(file);
  }

  await writeDb(db);
  return NextResponse.json({ ok: true, product });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = await readDb();
  const idx = db.products.findIndex((p) => p.id === id && p.business_id === businessId);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });
  db.products.splice(idx, 1);
  await writeDb(db);
  return NextResponse.json({ ok: true });
}
