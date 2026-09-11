import { NextRequest, NextResponse } from "next/server";
import { processAgentMessage } from "@/lib/ai/agent";
import { decryptSecret } from "@/lib/crypto/secrets";
import { getSessionUserId } from "@/lib/auth/session";
import { nowIso, readDb, uid, writeDb } from "@/lib/db/store";

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  const businessId = db.members.find((m) => m.user_id === userId)?.business_id;
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const message = String(body.message || "").trim();
  const history = Array.isArray(body.history) ? body.history : [];
  const pendingOrder = body.pendingOrder || null;
  const config = db.whatsapp_configs.find((c) => c.business_id === businessId);
  const business = db.businesses.find((b) => b.id === businessId);
  const products = db.products
    .filter((p) => p.business_id === businessId && p.is_active)
    .map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      description: p.description || undefined,
      image_url: p.image_url,
      category: p.category,
      sizes: p.sizes,
      stock: p.stock ?? null,
      sku: p.sku ?? null,
    }));
  const extra = (db.ai_instructions || [])
    .filter((i) => i.business_id === businessId && i.active)
    .map((i) => i.instruction)
    .join("\n");
  const started = Date.now();
  const result = await processAgentMessage({
    message,
    conversationHistory: history,
    businessName: business?.name || "Shop",
    agentName: config?.agent_name || "Order Assistant",
    products,
    pendingOrder,
    groqApiKey: decryptSecret(config?.groq_api_key) || config?.groq_api_key,
    groqModel: config?.groq_model,
    instructions: [config?.agent_instructions, extra].filter(Boolean).join("\n"),
    easypaisaNumber: config?.easypaisa_number,
    jazzcashNumber: config?.jazzcash_number,
    deliveryPolicy: extra || config?.agent_instructions,
  });
  if (!db.ai_logs) db.ai_logs = [];
  db.ai_logs.push({
    id: uid(),
    business_id: businessId,
    kind: "test_agent",
    model: config?.groq_model || process.env.GROQ_MODEL || null,
    latency_ms: Date.now() - started,
    error: null,
    created_at: nowIso(),
  });
  await writeDb(db);
  return NextResponse.json({
    reply: result.reply,
    intent: result.intent,
    action: result.action || null,
    tools: result.action ? [result.action] : [],
    parsed_order: result.parsed_order,
    should_create_order: result.should_create_order,
  });
}
