import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function keyBytes() {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET || "orderdesk-dev-secret";
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string | null | undefined): string | null {
  if (!plain) return null;
  if (plain.startsWith("enc:v1:")) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("enc:v1:")) return value;
  const parts = value.split(":");
  if (parts.length < 5) return null;
  try {
    const iv = Buffer.from(parts[2], "base64");
    const tag = Buffer.from(parts[3], "base64");
    const data = Buffer.from(parts.slice(4).join(":"), "base64");
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function maskSecret(value: string | null | undefined) {
  if (!value) return "";
  const plain = decryptSecret(value) || "";
  if (plain.length < 8) return "********";
  return `${plain.slice(0, 4)}${"*".repeat(Math.min(16, Math.max(8, plain.length - 8)))}${plain.slice(-4)}`;
}
