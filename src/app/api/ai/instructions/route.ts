import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { nowIso, readDb, uid, writeDb } from "@/lib/db/store";

async function businessIdForUser() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  return (await readDb()).members.find((m) => m.user_id === userId)?.business_id ?? null;
}

export async function GET() {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  const instructions = (db.ai_instructions || []).filter((i) => i.business_id === businessId);
  return NextResponse.json({ instructions });
}

export async function POST(request: NextRequest) {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const text = String(body.instruction || body.message || "").trim();
  if (!text) return NextResponse.json({ error: "Instruction required" }, { status: 400 });
  const db = await readDb();
  if (!db.ai_instructions) db.ai_instructions = [];
  const row = {
    id: uid(),
    business_id: businessId,
    instruction: text,
    active: true,
    priority: db.ai_instructions.filter((i) => i.business_id === businessId).length + 1,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  db.ai_instructions.push(row);
  await writeDb(db);
  return NextResponse.json({ ok: true, reply: "Instruction saved.", instruction: row });
}

export async function PATCH(request: NextRequest) {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const db = await readDb();
  const row = (db.ai_instructions || []).find((i) => i.id === body.id && i.business_id === businessId);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ("instruction" in body) row.instruction = String(body.instruction);
  if ("active" in body) row.active = Boolean(body.active);
  row.updated_at = nowIso();
  await writeDb(db);
  return NextResponse.json({ ok: true, instruction: row });
}

export async function DELETE(request: NextRequest) {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id");
  const db = await readDb();
  db.ai_instructions = (db.ai_instructions || []).filter((i) => !(i.id === id && i.business_id === businessId));
  await writeDb(db);
  return NextResponse.json({ ok: true });
}
