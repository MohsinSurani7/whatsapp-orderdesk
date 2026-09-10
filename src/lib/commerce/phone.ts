/** Canonical WhatsApp / PK mobile: 92XXXXXXXXXX */
export function normalizePhone(phone: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("92")) return digits;
  if (digits.startsWith("0") && digits.length >= 10) return `92${digits.slice(1)}`;
  if (digits.length === 10) return `92${digits}`;
  return digits;
}

export function phonesMatch(a: string, b: string) {
  return normalizePhone(a) === normalizePhone(b);
}
