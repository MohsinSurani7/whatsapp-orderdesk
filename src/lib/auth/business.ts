import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { Business } from "@/types/database";

export async function getCurrentBusiness() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("business_members")
    .select("business_id, role, businesses(*)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return { user, business: null as Business | null, role: null, businessId: null as string | null };

  const business = membership.businesses as unknown as Business;

  return {
    user,
    business,
    role: membership.role as string,
    businessId: membership.business_id as string,
  };
}

export async function requireBusiness() {
  const ctx = await getCurrentBusiness();
  if (!ctx.business || !ctx.businessId) redirect("/onboarding");
  return ctx as {
    user: typeof ctx.user;
    business: Business;
    role: string;
    businessId: string;
  };
}
