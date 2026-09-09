import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { readDb, uid, writeDb, type LocalWhatsAppConfig } from "@/lib/db/store";

async function businessIdForUser() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  return (await readDb()).members.find((m) => m.user_id === userId)?.business_id ?? null;
}

function publicConfig(config: LocalWhatsAppConfig) {
  return {
    id: config.id,
    business_id: config.business_id,
    phone_number_id: config.phone_number_id || "",
    waba_id: config.waba_id || "",
    verify_token: process.env.WHATSAPP_VERIFY_TOKEN || config.verify_token || "",
    agent_enabled: config.agent_enabled ?? true,
    agent_name: config.agent_name || "Order Assistant",
    agent_instructions: config.agent_instructions || "",
    agent_greeting: config.agent_greeting || "",
    has_token: Boolean(config.access_token),
    has_groq_key: Boolean(config.groq_api_key),
    easypaisa_number: config.easypaisa_number || "",
    jazzcash_number: config.jazzcash_number || "",
  };
}

async function ensureConfig(businessId: string) {
  const db = await readDb();
  let config = db.whatsapp_configs.find((c) => c.business_id === businessId);
  if (!config) {
    config = {
      id: uid(),
      business_id: businessId,
      phone_number_id: null,
      waba_id: null,
      access_token: null,
      verify_token: process.env.WHATSAPP_VERIFY_TOKEN || "",
      agent_enabled: true,
      agent_name: "Order Assistant",
      agent_greeting:
        "Assalam o Alaikum! Main aap ki order mein madad kar sakta hoon. Kya order karna chahte hain?",
      agent_instructions: null,
      groq_api_key: null,
      easypaisa_number: null,
      jazzcash_number: null,
      auto_confirm_orders: false,
    };
    db.whatsapp_configs.push(config);
    await writeDb(db);
  }
  return { db, config };
}

export async function GET() {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { config } = await ensureConfig(businessId);
  return NextResponse.json({ config: publicConfig(config) });
}

export async function PATCH(request: NextRequest) {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const updates = await request.json();
  const { db, config } = await ensureConfig(businessId);
  const live = db.whatsapp_configs.find((c) => c.id === config.id);
  if (!live) return NextResponse.json({ error: "Config not found" }, { status: 404 });

  const allowed = [
    "phone_number_id",
    "waba_id",
    "access_token",
    "verify_token",
    "agent_enabled",
    "agent_name",
    "agent_greeting",
    "agent_instructions",
    "groq_api_key",
    "easypaisa_number",
    "jazzcash_number",
    "auto_confirm_orders",
  ] as const;
  for (const key of allowed) {
    if (key in updates) {
      (live as unknown as Record<string, unknown>)[key] = updates[key];
    }
  }
  live.verify_token = process.env.WHATSAPP_VERIFY_TOKEN || live.verify_token;
  await writeDb(db);
  return NextResponse.json({ config: publicConfig(live) });
}