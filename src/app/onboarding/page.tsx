"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    businessName: "",
    businessType: "",
    country: "PK",
    currency: "PKR",
    phone: "",
    whatsappNumber: "",
    ownerName: "",
  });

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function finish() {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: business, error: bizError } = await supabase
      .from("businesses")
      .insert({
        name: form.businessName,
        business_type: form.businessType,
        country: form.country,
        currency: form.currency,
        phone: form.phone,
        whatsapp_number: form.whatsappNumber || form.phone,
        onboarding_completed: true,
      })
      .select()
      .single();

    if (bizError || !business) {
      setLoading(false);
      return;
    }

    await supabase.from("business_members").insert({
      business_id: business.id,
      user_id: user.id,
      role: "owner",
    });

    await supabase.from("whatsapp_configs").insert({
      business_id: business.id,
      agent_enabled: true,
      agent_name: "Order Assistant",
    });

    await supabase.from("subscriptions").insert({
      business_id: business.id,
      plan: "pro",
      status: "trialing",
      trial_ends_at: new Date(Date.now() + 14 * 86400000).toISOString(),
    });

    await supabase.from("whatsapp_templates").insert([
      { business_id: business.id, name: "Order Confirmation", template_key: "order_confirmation", content: "Hi {customer_name}, aap ka order #{order_number} confirm ho gaya hai. Total: {currency}{total}. Shukriya! - {business_name}" },
      { business_id: business.id, name: "Out for Delivery", template_key: "out_for_delivery", content: "Hi {customer_name}, aap ka order #{order_number} delivery ke liye nikal chuka hai." },
      { business_id: business.id, name: "Delivered", template_key: "delivered", content: "Hi {customer_name}, aap ka order #{order_number} deliver ho gaya hai. Shukriya! - {business_name}" },
      { business_id: business.id, name: "Payment Reminder", template_key: "payment_reminder", content: "Hi {customer_name}, order #{order_number} ka payment {currency}{total} pending hai." },
    ]);

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-6">
          <div className="mb-2 flex gap-2">
            {[1, 2].map((s) => (
              <div key={s} className={`h-1.5 flex-1 rounded-full ${s <= step ? "bg-green-600" : "bg-gray-200"}`} />
            ))}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Setup your business</h1>
          <p className="text-sm text-gray-500">Step {step} of 2 — WhatsApp AI agent ready hone ke liye</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{step === 1 ? "Business Details" : "WhatsApp Setup"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === 1 && (
              <>
                <div>
                  <Label>Business Name *</Label>
                  <Input value={form.businessName} onChange={(e) => update("businessName", e.target.value)} className="mt-1" placeholder="Ali's Bakery" />
                </div>
                <div>
                  <Label>Business Type</Label>
                  <Input value={form.businessType} onChange={(e) => update("businessType", e.target.value)} className="mt-1" placeholder="Home Baker, Clothing, etc." />
                </div>
                <div>
                  <Label>Your Name</Label>
                  <Input value={form.ownerName} onChange={(e) => update("ownerName", e.target.value)} className="mt-1" />
                </div>
                <Button onClick={() => setStep(2)} disabled={!form.businessName} className="w-full">
                  Continue
                </Button>
              </>
            )}

            {step === 2 && (
              <>
                <div>
                  <Label>Phone Number</Label>
                  <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} className="mt-1" placeholder="03001234567" />
                </div>
                <div>
                  <Label>WhatsApp Business Number *</Label>
                  <Input value={form.whatsappNumber} onChange={(e) => update("whatsappNumber", e.target.value)} className="mt-1" placeholder="03001234567" />
                  <p className="mt-1 text-xs text-gray-500">Is number pe AI agent automatically orders manage karega</p>
                </div>
                <div className="rounded-lg bg-green-50 p-4">
                  <p className="text-sm font-medium text-green-800">WhatsApp AI Agent</p>
                  <p className="mt-1 text-xs text-green-700">
                    Setup ke baad WhatsApp Cloud API connect karein. Tab tak agent dashboard se configure ho sakta hai.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Back</Button>
                  <Button onClick={finish} disabled={loading} className="flex-1">
                    {loading ? "Setting up..." : "Launch Dashboard"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
