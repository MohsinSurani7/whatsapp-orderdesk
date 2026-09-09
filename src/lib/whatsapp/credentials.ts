export function resolveWhatsAppAuth(config?: {
  access_token?: string | null;
  phone_number_id?: string | null;
} | null) {
  const accessToken = (config?.access_token || "").trim();
  const phoneNumberId = (config?.phone_number_id || "").trim();
  return { accessToken, phoneNumberId };
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

  const expired = /expired|code":190|error_subcode":463/i.test(body);
  return {
    ok: false as const,
    reason: expired ? ("expired" as const) : ("graph_error" as const),
    message: expired
      ? "WhatsApp access token expire ho chuka hai. Dashboard → WhatsApp → naya token paste karke Save Token dabao. Code ya Netlify env change ki zaroorat nahi."
      : "WhatsApp Graph API token reject kar rahi hai. Dashboard pe Phone Number ID aur token check karo.",
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
