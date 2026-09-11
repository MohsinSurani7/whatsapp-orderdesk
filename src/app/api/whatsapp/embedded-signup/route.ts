import { NextRequest, NextResponse } from "next/server";
import { encryptSecret } from "@/lib/crypto/secrets";
import { metaAppSecret, metaPublicSignupConfig } from "@/lib/env/server";
import { getSessionUserId } from "@/lib/auth/session";
import { nowIso, readDb, writeDb } from "@/lib/db/store";
import { slog } from "@/lib/observability/log";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const pub = metaPublicSignupConfig();
  return NextResponse.json({
    appId: pub.appId,
    configId: pub.configId,
    graphVersion: pub.graphVersion,
    configured: pub.configured,
  });
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  const businessId = db.members.find((m) => m.user_id === userId)?.business_id;
  if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pub = metaPublicSignupConfig();
  const appId = pub.appId;
  const secret = metaAppSecret();
  const GRAPH = `https://graph.facebook.com/${pub.graphVersion}`;
  if (!appId || !secret) {
    return NextResponse.json(
      { error: "Meta Embedded Signup is not fully configured on the server." },
      { status: 400 }
    );
  }

  const body = await request.json();
  const code = String(body.code || "");
  if (!code) return NextResponse.json({ error: "Missing Embedded Signup code" }, { status: 400 });

  slog("META", "Embedded Signup code received");
  const tokenUrl = `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(code)}`;
  const tokenRes = await fetch(tokenUrl, { cache: "no-store" });
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: { message?: string } };
  if (!tokenRes.ok || !tokenJson.access_token) {
    slog("META", "Token exchange failed");
    return NextResponse.json(
      { error: tokenJson.error?.message || "Could not exchange Meta code. Connection is not marked active." },
      { status: 400 }
    );
  }

  const accessToken = tokenJson.access_token;
  const debugRes = await fetch(
    `${GRAPH}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${secret}`)}`,
    { cache: "no-store" }
  );
  const debugJson = (await debugRes.json()) as { data?: { granular_scopes?: Array<{ scope: string; target_ids?: string[] }> } };
  const wabaId =
    String(body.waba_id || "") ||
    debugJson.data?.granular_scopes?.find((s) => /whatsapp_business_management/.test(s.scope))?.target_ids?.[0] ||
    "";

  let phoneNumberId = String(body.phone_number_id || "");
  let displayPhone = "";
  let verifiedName = "";
  if (wabaId) {
    const phonesRes = await fetch(`${GRAPH}/${wabaId}/phone_numbers?access_token=${encodeURIComponent(accessToken)}`, {
      cache: "no-store",
    });
    const phones = (await phonesRes.json()) as {
      data?: Array<{ id: string; display_phone_number?: string; verified_name?: string }>;
    };
    const first = phones.data?.[0];
    if (first) {
      phoneNumberId = phoneNumberId || first.id;
      displayPhone = first.display_phone_number || "";
      verifiedName = first.verified_name || "";
    }
  }

  if (!phoneNumberId) {
    return NextResponse.json(
      { error: "WABA connected but no phone number was returned. Complete signup in Meta and try again." },
      { status: 400 }
    );
  }

  const live = db.whatsapp_configs.find((c) => c.business_id === businessId);
  if (!live) return NextResponse.json({ error: "WhatsApp config missing" }, { status: 404 });
  live.access_token = encryptSecret(accessToken);
  live.waba_id = wabaId || live.waba_id;
  live.phone_number_id = phoneNumberId;
  live.display_phone_number = displayPhone;
  live.verified_name = verifiedName;
  live.connection_status = "connected";
  live.last_webhook_at = nowIso();
  await writeDb(db);
  slog("META", "WhatsApp connected", { phone_number_id: phoneNumberId });
  return NextResponse.json({
    ok: true,
    connected: true,
    waba_id: wabaId,
    phone_number_id: phoneNumberId,
    display_phone_number: displayPhone,
    verified_name: verifiedName,
  });
}
