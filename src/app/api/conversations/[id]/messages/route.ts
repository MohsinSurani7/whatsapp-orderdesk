import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { readDb, writeDb } from "@/lib/db/store";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = await readDb();
  const businessId = db.members.find((m) => m.user_id === userId)?.business_id;
  const conv = db.conversations.find((c) => c.id === id && c.business_id === businessId);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  db.messages = db.messages.filter((m) => m.conversation_id !== id);
  await writeDb(db);
  return NextResponse.json({ ok: true });
}
