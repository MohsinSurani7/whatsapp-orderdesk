import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { readDb, writeDb } from "@/lib/db/store";

async function ownedConversation(id: string) {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const db = await readDb();
  const businessId = db.members.find((m) => m.user_id === userId)?.business_id;
  if (!businessId) return null;
  const conv = db.conversations.find((c) => c.id === id && c.business_id === businessId);
  if (!conv) return null;
  return { db, conv, businessId };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await ownedConversation(id);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.agent_paused === "boolean") {
    ctx.conv.agent_paused = body.agent_paused;
    ctx.conv.status = body.agent_paused ? "handed_off" : "active";
  }
  await writeDb(ctx.db);
  return NextResponse.json({
    ok: true,
    agent_paused: ctx.conv.agent_paused === true,
    status: ctx.conv.status,
  });
}
