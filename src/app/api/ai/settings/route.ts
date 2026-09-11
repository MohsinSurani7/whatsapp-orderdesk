import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { encryptSecret, maskSecret, decryptSecret } from "@/lib/crypto/secrets";
import { readDb, writeDb } from "@/lib/db/store";

async function businessIdForUser() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  return (await readDb()).members.find((m) => m.user_id === userId)?.business_id ?? null;
}

export async function GET() {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  const config = db.whatsapp_configs.find((c) => c.business_id === businessId);
  const instructions = (db.ai_instructions || []).filter((i) => i.business_id === businessId);
  const logs = (db.ai_logs || []).filter((l) => l.business_id === businessId).slice(-20).reverse();
  return NextResponse.json({
    settings: {
      agent_enabled: config?.agent_enabled ?? true,
      agent_name: config?.agent_name || "Order Assistant",
      groq_model: config?.groq_model || process.env.GROQ_MODEL || "openai/gpt-oss-20b",
      groq_temperature: config?.groq_temperature ?? 0.35,
      groq_max_tokens: config?.groq_max_tokens ?? 1200,
      agent_language: config?.agent_language || "auto",
      agent_instructions: config?.agent_instructions || "",
      groq_key_masked: maskSecret(config?.groq_api_key),
      has_groq_key: Boolean(config?.groq_api_key || process.env.GROQ_API_KEY),
      easypaisa_number: config?.easypaisa_number || "",
      jazzcash_number: config?.jazzcash_number || "",
    },
    instructions,
    logs,
  });
}

export async function PATCH(request: NextRequest) {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const db = await readDb();
  const live = db.whatsapp_configs.find((c) => c.business_id === businessId);
  if (!live) return NextResponse.json({ error: "Config not found" }, { status: 404 });
  if ("agent_enabled" in body) live.agent_enabled = Boolean(body.agent_enabled);
  if ("agent_name" in body) live.agent_name = String(body.agent_name);
  if ("groq_model" in body) live.groq_model = String(body.groq_model);
  if ("groq_temperature" in body) live.groq_temperature = Number(body.groq_temperature);
  if ("groq_max_tokens" in body) live.groq_max_tokens = Number(body.groq_max_tokens);
  if ("agent_language" in body) live.agent_language = String(body.agent_language);
  if ("agent_instructions" in body) live.agent_instructions = String(body.agent_instructions);
  if ("easypaisa_number" in body) live.easypaisa_number = String(body.easypaisa_number);
  if ("jazzcash_number" in body) live.jazzcash_number = String(body.jazzcash_number);
  if (typeof body.groq_api_key === "string" && body.groq_api_key.trim()) {
    live.groq_api_key = encryptSecret(body.groq_api_key.trim());
  }
  if (body.remove_groq_key) live.groq_api_key = null;
  await writeDb(db);
  return GET();
}

export async function POST(request: NextRequest) {
  const businessId = await businessIdForUser();
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const db = await readDb();
  const config = db.whatsapp_configs.find((c) => c.business_id === businessId);
  const key =
    decryptSecret(config?.groq_api_key) ||
    config?.groq_api_key ||
    process.env.GROQ_API_KEY ||
    String(body.groq_api_key || "");
  if (!key) return NextResponse.json({ ok: false, message: "Groq API key missing" }, { status: 400 });
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, message: "Groq connection failed" });
    }
    return NextResponse.json({ ok: true, message: "Groq connection successful" });
  } catch {
    return NextResponse.json({ ok: false, message: "Groq connection failed" });
  }
}
