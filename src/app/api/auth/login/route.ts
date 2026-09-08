import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readDb, verifyPassword } from "@/lib/db/store";
import { applySessionCookie } from "@/lib/auth/session";
import { publicOrigin } from "@/lib/http/origin";
import { isSupabaseEnabled } from "@/lib/db/supabase-sync";

async function credentials(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json();
    return { email: String(body.email || ""), password: String(body.password || "") };
  }
  const form = await request.formData();
  return {
    email: String(form.get("email") || ""),
    password: String(form.get("password") || ""),
  };
}

export async function POST(request: NextRequest) {
  const { email, password } = await credentials(request);
  const origin = publicOrigin(request);
  const isJson = request.headers.get("content-type")?.includes("application/json");

  if (isSupabaseEnabled()) {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data, error } = await sb.auth.signInWithPassword({ email: email.toLowerCase(), password });
    if (error || !data.user) {
      if (isJson) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
      return NextResponse.redirect(new URL("/login?error=invalid", origin), 303);
    }
    if (isJson) {
      const res = NextResponse.json({ ok: true });
      await applySessionCookie(res, data.user.id, origin);
      return res;
    }
    const res = NextResponse.redirect(new URL("/dashboard", origin), 303);
    await applySessionCookie(res, data.user.id, origin);
    return res;
  }

  const db = await readDb();
  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());

  if (!user || !verifyPassword(password, user.password_hash)) {
    if (isJson) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    return NextResponse.redirect(new URL("/login?error=invalid", origin), 303);
  }

  if (isJson) {
    const res = NextResponse.json({ ok: true });
    await applySessionCookie(res, user.id, origin);
    return res;
  }

  const res = NextResponse.redirect(new URL("/dashboard", origin), 303);
  await applySessionCookie(res, user.id, origin);
  return res;
}
