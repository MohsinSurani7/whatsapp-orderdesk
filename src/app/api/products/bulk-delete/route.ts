import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { readDb, writeDb } from "@/lib/db/store";

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  const businessId = db.members.find((m) => m.user_id === userId)?.business_id;
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map((x: unknown) => String(x)).filter(Boolean) : [];
  if (!ids.length) return NextResponse.json({ error: "No products selected" }, { status: 400 });
  const idSet = new Set(ids);
  const before = db.products.length;
  db.products = db.products.filter((p) => !(p.business_id === businessId && idSet.has(p.id)));
  await writeDb(db);
  return NextResponse.json({ ok: true, deleted: before - db.products.length });
}
