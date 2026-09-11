import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { readDb, writeDb } from "@/lib/db/store";
import { slog } from "@/lib/observability/log";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  const businessId = db.members.find((m) => m.user_id === userId)?.business_id;
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const live = db.whatsapp_configs.find((c) => c.business_id === businessId);
  if (!live) return NextResponse.json({ error: "Not found" }, { status: 404 });
  live.access_token = null;
  live.phone_number_id = null;
  live.waba_id = null;
  live.display_phone_number = null;
  live.verified_name = null;
  live.connection_status = "disconnected";
  await writeDb(db);
  slog("META", "WhatsApp disconnected", { business_id: businessId });
  return NextResponse.json({ ok: true });
}
