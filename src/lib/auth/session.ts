import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const SESSION_COOKIE = "orderdesk_session";

function secret() {
  return process.env.SESSION_SECRET || "orderdesk-dev-session-secret";
}

function bytesToBase64Url(bytes: Uint8Array) {
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmac(payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToBase64Url(new Uint8Array(sig));
}

export async function signUserId(userId: string) {
  const payload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify({ userId, exp: Date.now() + 30 * 86400000 }))
  );
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = await hmac(payload);
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(payload));
    const data = JSON.parse(json) as { userId: string; exp: number };
    if (!data.userId || data.exp < Date.now()) return null;
    return data.userId;
  } catch {
    return null;
  }
}

export function cookieOptions(requestUrl?: string) {
  const https =
    requestUrl?.startsWith("https://") ||
    process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://");
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 30 * 86400,
    secure: Boolean(https),
  };
}

export async function applySessionCookie(
  response: NextResponse,
  userId: string,
  requestUrl?: string
) {
  response.cookies.set(SESSION_COOKIE, await signUserId(userId), cookieOptions(requestUrl));
  return response;
}

export async function setSessionCookie(userId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signUserId(userId), cookieOptions(process.env.NEXT_PUBLIC_APP_URL));
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getSessionUserId() {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value);
}
