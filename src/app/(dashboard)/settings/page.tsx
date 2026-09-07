import { requireBusiness } from "@/lib/auth/business";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SettingsPage() {
  const { business, businessId } = await requireBusiness();
  const supabase = await createClient();

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("business_id", businessId)
    .single();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      <Card>
        <CardHeader><CardTitle>Business</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><span className="text-gray-500">Name:</span> {business.name}</p>
          <p><span className="text-gray-500">Currency:</span> {business.currency}</p>
          <p><span className="text-gray-500">WhatsApp:</span> {business.whatsapp_number ?? "Not set"}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Subscription</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><span className="text-gray-500">Plan:</span> <span className="capitalize">{subscription?.plan ?? "starter"}</span></p>
          <p><span className="text-gray-500">Status:</span> <span className="capitalize">{subscription?.status ?? "trialing"}</span></p>
        </CardContent>
      </Card>
    </div>
  );
}
