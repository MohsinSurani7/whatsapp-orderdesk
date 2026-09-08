import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth/session";
import { readDb } from "@/lib/db/store";
import type { Business } from "@/types/database";

export async function getCurrentBusiness() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const db = await readDb();
  const user = db.users.find((u) => u.id === userId) ?? {
    id: userId,
    email: "",
    full_name: "",
    password_hash: "",
    created_at: "",
  };

  const membership = db.members.find((m) => m.user_id === userId);
  const authUser = { id: user.id, email: user.email };

  if (!membership) {
    return { user: authUser, business: null as Business | null, role: null, businessId: null as string | null };
  }

  const business = db.businesses.find((b) => b.id === membership.business_id) as unknown as Business | undefined;
  return {
    user: authUser,
    business: business ?? null,
    role: membership.role,
    businessId: membership.business_id,
  };
}

export async function requireBusiness() {
  const ctx = await getCurrentBusiness();
  if (!ctx.business || !ctx.businessId) redirect("/onboarding");
  return ctx as {
    user: { id: string; email: string };
    business: Business;
    role: string;
    businessId: string;
  };
}
