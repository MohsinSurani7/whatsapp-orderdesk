import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processAgentMessage } from "@/lib/ai/agent";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { text, businessId } = await request.json();

  const { data: business } = await supabase
    .from("businesses")
    .select("name")
    .eq("id", businessId)
    .single();

  const { data: products } = await supabase
    .from("products")
    .select("name, price")
    .eq("business_id", businessId)
    .eq("is_active", true);

  const result = await processAgentMessage({
    message: text,
    conversationHistory: [],
    businessName: business?.name ?? "Business",
    agentName: "Order Assistant",
    products: products ?? [],
  });

  return NextResponse.json(result);
}
