import { NextRequest, NextResponse } from "next/server";
import { hashPassword, nowIso, readDb, uid, writeDb } from "@/lib/db/store";
import { applySessionCookie } from "@/lib/auth/session";
import { publicOrigin } from "@/lib/http/origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseEnabled } from "@/lib/db/supabase-sync";

async function payload(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json();
    return {
      email: String(body.email || ""),
      password: String(body.password || ""),
      fullName: String(body.fullName || ""),
    };
  }
  const form = await request.formData();
  return {
    email: String(form.get("email") || ""),
    password: String(form.get("password") || ""),
    fullName: String(form.get("fullName") || ""),
  };
}

export async function POST(request: NextRequest) {
  const { email, password, fullName } = await payload(request);
  const origin = publicOrigin(request);
  const isJson = request.headers.get("content-type")?.includes("application/json");

  if (!email || !password) {
    if (isJson) return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    return NextResponse.redirect(new URL("/signup?error=required", origin), 303);
  }

  if (isSupabaseEnabled()) {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) {
      const exists = /already|registered|exists/i.test(error?.message || "");
      if (isJson) return NextResponse.json({ error: error?.message || "Signup failed" }, { status: 400 });
      return NextResponse.redirect(new URL(exists ? "/signup?error=exists" : "/signup?error=failed", origin), 303);
    }

    await admin.from("profiles").upsert({
      id: data.user.id,
      email: email.toLowerCase(),
      full_name: fullName || null,
    });

    if (isJson) {
      const res = NextResponse.json({ ok: true, userId: data.user.id });
      await applySessionCookie(res, data.user.id, origin);
      return res;
    }
    const res = NextResponse.redirect(new URL("/onboarding", origin), 303);
    await applySessionCookie(res, data.user.id, origin);
    return res;
  }

  const db = await readDb();
  if (db.users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
    if (isJson) return NextResponse.json({ error: "This email is already registered" }, { status: 400 });
    return NextResponse.redirect(new URL("/signup?error=exists", origin), 303);
  }

  const user = {
    id: uid(),
    email: email.toLowerCase(),
    full_name: fullName,
    password_hash: hashPassword(password),
    created_at: nowIso(),
  };
  db.users.push(user);
  await writeDb(db);

  if (isJson) {
    const res = NextResponse.json({ ok: true, userId: user.id });
    await applySessionCookie(res, user.id, origin);
    return res;
  }

  const res = NextResponse.redirect(new URL("/onboarding", origin), 303);
  await applySessionCookie(res, user.id, origin);
  return res;
}
