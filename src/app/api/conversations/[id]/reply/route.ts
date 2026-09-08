import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { envWhatsAppDefaults, nowIso, readDb, uid, writeDb } from "@/lib/db/store";
import { sendWhatsAppText } from "@/lib/whatsapp/client";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { text } = await request.json();
  const db = await readDb();
  const businessId = db.members.find((m) => m.user_id === userId)?.business_id;
  const conv = db.conversations.find((c) => c.id === id && c.business_id === businessId);
  if (!conv || !text) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const config = db.whatsapp_configs.find((c) => c.business_id === businessId);
  const env = envWhatsAppDefaults();
  const token = process.env.WHATSAPP_ACCESS_TOKEN || env.access_token || config?.access_token;
  const phoneNumberId = config?.phone_number_id || env.phone_number_id;

  let waId: string | null = null;
  if (token && phoneNumberId) {
    const sent = await sendWhatsAppText({
      phoneNumberId,
      accessToken: token,
      to: conv.customer_phone,
      message: String(text),
    });
    waId = sent?.messages?.[0]?.id ?? null;
  }

  db.messages.push({
    id: uid(),
    business_id: conv.business_id,
    conversation_id: conv.id,
    direction: "outbound",
    message_type: "text",
    content: String(text),
    whatsapp_message_id: waId,
    image_url: null,
    created_at: nowIso(),
  });
  conv.last_message_at = nowIso();
  await writeDb(db);
  return NextResponse.json({ ok: true });
}
