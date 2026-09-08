import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { envWhatsAppDefaults, readDb } from "@/lib/db/store";
import { inspectWhatsAppToken, resolveWhatsAppAuth } from "@/lib/whatsapp/credentials";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await readDb();
  const businessId = db.members.find((m) => m.user_id === userId)?.business_id;
  const config = businessId ? db.whatsapp_configs.find((c) => c.business_id === businessId) : null;
  const env = envWhatsAppDefaults();
  const { accessToken, phoneNumberId } = resolveWhatsAppAuth({
    access_token: config?.access_token || env.access_token,
    phone_number_id: config?.phone_number_id || env.phone_number_id,
  });

  const status = await inspectWhatsAppToken(accessToken, phoneNumberId);
  return NextResponse.json({
    ...status,
    webhookUrl: `${(process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "")}/api/webhooks/whatsapp`,
    hasToken: Boolean(accessToken),
    hasPhoneId: Boolean(phoneNumberId),
    agentEnabled: config?.agent_enabled ?? true,
  });
}
