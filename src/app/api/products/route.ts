import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getSessionUserId } from "@/lib/auth/session";
import { nowIso, readDb, uid, writeDb } from "@/lib/db/store";
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

export async function GET() {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  const products = db.products.filter((p) => p.business_id === businessId);
  return NextResponse.json({ products });
}

export async function POST(request: NextRequest) {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  const name = String(form.get("name") || "");
  const price = parseFloat(String(form.get("price") || "0"));
  const sku = String(form.get("sku") || "") || null;
  const stockRaw = String(form.get("stock") || "");
  const description = String(form.get("description") || "") || null;
  const category = String(form.get("category") || "") || null;
  const sizes = String(form.get("sizes") || "") || null;
  const file = form.get("image");

  let image_url: string | null = null;
  if (file instanceof File && file.size > 0) {
    image_url = await saveImage(file);
  }

  const db = await readDb();
  db.products.push({
    id: uid(),
    business_id: businessId,
    name,
    sku,
    description,
    price,
    cost: null,
    stock: stockRaw ? parseInt(stockRaw, 10) : null,
    image_url,
    category,
    sizes,
    is_active: true,
    created_at: nowIso(),
  });
  await writeDb(db);
  return NextResponse.json({ ok: true });
}
