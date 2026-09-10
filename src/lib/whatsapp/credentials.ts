export function resolveWhatsAppAuth(config?: {
  access_token?: string | null;
  phone_number_id?: string | null;
} | null) {
  const accessToken = (config?.access_token || "").trim();
  const phoneNumberId = (config?.phone_number_id || "").trim();
  return { accessToken, phoneNumberId };
}

export function explainWhatsAppGraphError(body: string) {
  const blocked = /API access blocked|code":200|"code": 200/i.test(body);
  const expired = /expired|code":190|error_subcode":463/i.test(body);
  const permission = /code":10|permission|not been granted|missing permissions|#200/i.test(body);
  if (expired) {
    return {
      reason: "expired" as const,
      message:
        "WhatsApp access token expire ho chuka hai. Meta → System User se naya Permanent token generate karke Dashboard → WhatsApp pe Save Token karein.",
    };
  }
  if (blocked || permission) {
    return {
      reason: "blocked" as const,
      message:
        "Token save hai, lekin Meta ne WhatsApp API access block kiya hai (error 200). Ye expire nahi — app/permissions ka issue hai. Meta App ko Live mode karein, whatsapp_business_messaging + whatsapp_business_management permissions Advanced Access dein, Phone Number ID isi WABA/app se match karein, aur Business verification complete karein. Development mode mein sirf testers ko message jata hai.",
    };
  }
  return {
    reason: "graph_error" as const,
    message: "WhatsApp Graph API ne request reject ki. Phone Number ID, WABA, aur token wali Meta App check karein.",
  };
}

type TokenHealth = Awaited<ReturnType<typeof inspectWhatsAppTokenUncached>>;

const healthCache = new Map<string, { at: number; value: TokenHealth }>();

async function inspectWhatsAppTokenUncached(accessToken: string, phoneNumberId: string) {
  if (!accessToken || !phoneNumberId) {
    return {
      ok: false as const,
      reason: "missing" as const,
      message: "WhatsApp token ya Phone Number ID missing hai.",
    };
  }

  const response = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=id,display_phone_number,verified_name`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
  const body = await response.text();
  if (response.ok) {
    return { ok: true as const, reason: "ok" as const, message: "WhatsApp token valid hai." };
  }

  const parsed = explainWhatsAppGraphError(body);
  return {
    ok: false as const,
    reason: parsed.reason,
    message: parsed.message,
  };
}

export async function inspectWhatsAppToken(accessToken: string, phoneNumberId: string) {
  const cacheKey = `${phoneNumberId}:${accessToken.slice(-12)}`;
  const hit = healthCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 90_000) return hit.value;
  const value = await inspectWhatsAppTokenUncached(accessToken, phoneNumberId);
  healthCache.set(cacheKey, { at: Date.now(), value });
  return value;
}
