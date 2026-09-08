import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { envWhatsAppDefaults, readDb, writeDb } from "@/lib/db/store";

async function businessIdForUser() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  return (await readDb()).members.find((m) => m.user_id === userId)?.business_id ?? null;
}

export async function GET() {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  const env = envWhatsAppDefaults();
  const config = db.whatsapp_configs.find((c) => c.business_id === businessId);
  return NextResponse.json({
    config: {
      id: config?.id,
      business_id: config?.business_id,
      phone_number_id: config?.phone_number_id || env.phone_number_id,
      waba_id: config?.waba_id || env.waba_id,
      verify_token: config?.verify_token || env.verify_token,
      agent_enabled: config?.agent_enabled ?? true,
      agent_name: config?.agent_name || "Order Assistant",
      agent_instructions: config?.agent_instructions || "",
      agent_greeting: config?.agent_greeting || "",
      has_token: Boolean(config?.access_token || env.access_token),
    },
  });
}

export async function PATCH(request: NextRequest) {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const updates = await request.json();
  const db = await readDb();
  const config = db.whatsapp_configs.find((c) => c.business_id === businessId);
  if (!config) return NextResponse.json({ error: "Config not found" }, { status: 404 });
  const allowed = [
    "phone_number_id",
    "waba_id",
    "access_token",
    "verify_token",
    "agent_enabled",
    "agent_name",
    "agent_greeting",
    "agent_instructions",
    "auto_confirm_orders",
  ] as const;
  for (const key of allowed) {
    if (key in updates) {
      (config as unknown as Record<string, unknown>)[key] = updates[key];
    }
  }
  await writeDb(db);
  return NextResponse.json({
    config: {
      ...config,
      access_token: undefined,
      has_token: Boolean(config.access_token),
    },
  });
}
