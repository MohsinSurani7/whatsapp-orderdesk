"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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
    setError("");
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not save business");
      setLoading(false);
      return;
    }
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
                  <Label>WhatsApp Business Number</Label>
                  <Input value={form.whatsappNumber} onChange={(e) => update("whatsappNumber", e.target.value)} className="mt-1" placeholder="03001234567" />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
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
