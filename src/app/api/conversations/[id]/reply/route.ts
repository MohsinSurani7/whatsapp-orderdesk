import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { nowIso, readDb, uid, writeDb } from "@/lib/db/store";
import { sendWhatsAppText } from "@/lib/whatsapp/client";
import { resolveWhatsAppAuth } from "@/lib/whatsapp/credentials";

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
  const { accessToken, phoneNumberId } = resolveWhatsAppAuth(config);
  if (!accessToken || !phoneNumberId) {
    return NextResponse.json(
      { error: "Pehle Dashboard → WhatsApp pe Access Token aur Phone Number ID save karein." },
      { status: 400 }
    );
  }

  let waId: string | null = null;
  try {
    const sent = await sendWhatsAppText({
      phoneNumberId,
      accessToken,
      to: conv.customer_phone,
      message: String(text),
    });
    waId = sent?.messages?.[0]?.id ?? null;
  } catch (error) {
    return NextResponse.json(
      { error: String(error).includes("expired") || String(error).includes("190")
          ? "WhatsApp token expire hai. Dashboard → WhatsApp pe naya token save karein."
          : "WhatsApp pe message nahi gaya. Token / number check karein." },
      { status: 502 }
    );
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
  conv.status = "active";
  await writeDb(db);
  return NextResponse.json({ ok: true });
}
