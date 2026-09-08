import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { readDb } from "@/lib/db/store";
import { processAgentMessage } from "@/lib/ai/agent";

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { text } = await request.json();
  const db = await readDb();
  const businessId = db.members.find((m) => m.user_id === userId)?.business_id;
  const business = db.businesses.find((b) => b.id === businessId);
  const products = db.products
    .filter((p) => p.business_id === businessId && p.is_active)
    .map((p) => ({ name: p.name, price: p.price }));

  const result = await processAgentMessage({
    message: text,
    conversationHistory: [],
    businessName: business?.name ?? "Business",
    agentName: "Order Assistant",
    products,
  });

  return NextResponse.json(result);
}
