import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import {
  defaultTemplates,
  nowIso,
  readDb,
  uid,
  writeDb,
} from "@/lib/db/store";

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const db = await readDb();

  const already = db.members.find((m) => m.user_id === userId);
  if (already) {
    return NextResponse.json({ ok: true });
  }

  let business = db.businesses.find(
    (b) => !db.members.some((m) => m.business_id === b.id)
  );

  if (!business) {
    business = {
      id: uid(),
      name: String(body.businessName || "My Business"),
      business_type: body.businessType || null,
      country: body.country || "PK",
      currency: body.currency || "PKR",
      timezone: "Asia/Karachi",
      phone: body.phone || null,
      whatsapp_number: body.whatsappNumber || body.phone || null,
      address: null,
      logo_url: null,
      invoice_prefix: "ORD",
      default_order_status: "pending",
      default_payment_method: "cod",
      onboarding_completed: true,
      created_at: nowIso(),
    };
    db.businesses.push(business);
  } else {
    business.name = String(body.businessName || business.name);
    business.business_type = body.businessType || business.business_type;
    business.phone = body.phone || business.phone;
    business.whatsapp_number = body.whatsappNumber || body.phone || business.whatsapp_number;
    business.onboarding_completed = true;
  }

  db.members.push({
    id: uid(),
    business_id: business.id,
    user_id: userId,
    role: "owner",
  });

  if (!db.whatsapp_configs.some((c) => c.business_id === business.id)) {
    db.whatsapp_configs.push({
      id: uid(),
      business_id: business.id,
      phone_number_id: null,
      waba_id: null,
      access_token: null,
      verify_token: process.env.WHATSAPP_VERIFY_TOKEN || "",
      agent_enabled: true,
      agent_name: "Order Assistant",
      agent_greeting:
        "Assalam o Alaikum! Main aap ki order mein madad kar sakta hoon. Kya order karna chahte hain?",
      agent_instructions: null,
      auto_confirm_orders: false,
    });
  }

  if (!db.templates.some((t) => t.business_id === business.id)) {
    db.templates.push(...defaultTemplates(business.id));
  }

  if (!db.subscriptions.some((s) => s.business_id === business.id)) {
    db.subscriptions.push({
      id: uid(),
      business_id: business.id,
      plan: "pro",
      status: "trialing",
    });
  }

  await writeDb(db);
  return NextResponse.json({ ok: true });
}
