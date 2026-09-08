"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Bot, CheckCircle, Copy, ExternalLink } from "lucide-react";

export default function WhatsAppAgentPage() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [groqInput, setGroqInput] = useState("");
  const [health, setHealth] = useState<{ ok?: boolean; message?: string; reason?: string } | null>(null);
  const webhookUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/whatsapp` : "/api/webhooks/whatsapp";

  useEffect(() => {
    fetch("/api/whatsapp/config")
      .then((r) => r.json())
      .then((d) => setConfig(d.config || {}));
    fetch("/api/whatsapp/health")
      .then((r) => r.json())
      .then((d) => setHealth(d));
  }, []);

  async function saveConfig(updates: Record<string, unknown>) {
    setSaving(true);
    const res = await fetch("/api/whatsapp/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    setConfig(data.config || { ...config, ...updates });
    setSaving(false);
  }

  function copyText(value: string, key: string) {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(""), 2000);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">WhatsApp AI Agent</h1>
        <p className="text-sm text-gray-500">Ye agent WhatsApp chats ke andar automatically orders manage karta hai</p>
      </div>
      {health && health.ok === false && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="p-4 text-sm text-red-800">
            <p className="font-semibold">Agent reply nahi kar raha — WhatsApp token invalid/expired</p>
            <p className="mt-1">{health.message}</p>
            <p className="mt-2 text-red-700">
              Meta se naya token generate karke <strong>yahi dashboard</strong> mein Save Token dabao. Code edit ya Netlify
              redeploy ki zaroorat nahi.
            </p>
          </CardContent>
        </Card>
      )}
      {health?.ok && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-4 text-sm text-green-800">{health.message}</CardContent>
        </Card>
      )}
      <Card className="border-green-200">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-600">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle>AI Agent Status</CardTitle>
            </div>
            <Badge variant={config?.agent_enabled ? "success" : "default"} className="ml-auto">
              {config?.agent_enabled ? "Active" : "Disabled"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Agent Name</Label>
              <Input
                defaultValue={String(config?.agent_name ?? "Order Assistant")}
                onBlur={(e) => saveConfig({ agent_name: e.target.value })}
                className="mt-1"
              />
            </div>
            <div className="flex items-end">
              <Button
                variant={config?.agent_enabled ? "destructive" : "default"}
                onClick={() => saveConfig({ agent_enabled: !config?.agent_enabled })}
                disabled={saving}
              >
                {config?.agent_enabled ? "Disable Agent" : "Enable Agent"}
              </Button>
            </div>
          </div>
          <div>
            <Label>Agent training notes (apna business)</Label>
            <textarea
              defaultValue={String(config?.agent_instructions ?? "")}
              onBlur={(e) => saveConfig({ agent_instructions: e.target.value })}
              rows={4}
              placeholder="Example: Hum clothing store hain. Cotton suits, lawn, unstitched. Delivery Lahore 200, bahir 400. COD available."
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Agent ChatGPT ki tarah alag se train nahi hota. Products + ye notes uska knowledge hain.
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp Cloud API Connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Phone Number ID</Label>
            <Input
              defaultValue={String(config?.phone_number_id ?? "")}
              onBlur={(e) => saveConfig({ phone_number_id: e.target.value.trim() })}
              className="mt-1"
              placeholder="Meta → WhatsApp → API Setup"
            />
          </div>
          <div>
            <Label>WABA ID (optional)</Label>
            <Input
              defaultValue={String(config?.waba_id ?? "")}
              onBlur={(e) => saveConfig({ waba_id: e.target.value.trim() })}
              className="mt-1"
              placeholder="WhatsApp Business Account ID"
            />
          </div>
          <div>
            <Label>Access Token (Meta)</Label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder={config?.has_token ? "Token saved — naya paste karke save karo" : "EAAG... token paste karo"}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                disabled={saving || tokenInput.trim().length < 20}
                onClick={async () => {
                  await saveConfig({ access_token: tokenInput.trim() });
                  setTokenInput("");
                  const next = await fetch("/api/whatsapp/health").then((r) => r.json());
                  setHealth(next);
                }}
              >
                Save Token
              </Button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Token yahi save hota hai (har shop ka apna). Temporary token ~24h. Permanent: Meta Business Settings →
              System Users → Generate token (`whatsapp_business_management` + `whatsapp_business_messaging`).
            </p>
          </div>
          <div>
            <Label>Groq API key (is shop ka apna AI)</Label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                value={groqInput}
                onChange={(e) => setGroqInput(e.target.value)}
                placeholder={
                  config?.has_groq_key ? "Groq key saved — naya paste karke save karo" : "gsk_... Groq key paste karo"
                }
                className="font-mono text-xs"
              />
              <Button
                type="button"
                disabled={saving || groqInput.trim().length < 20}
                onClick={async () => {
                  await saveConfig({ groq_api_key: groqInput.trim() });
                  setGroqInput("");
                }}
              >
                Save Groq Key
              </Button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Free key: console.groq.com → API Keys. Har buyer apni key yahan lagaye taake AI quota mix na ho. Llama 8B
              Instant use hota hai — tez aur dashboard catalog se reply karta hai.
            </p>
          </div>
          <div>
            <Label>Webhook URL (Meta pe yehi lagao)</Label>
            <div className="mt-1 flex gap-2">
              <Input value={webhookUrl} readOnly className="bg-gray-50 font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={() => copyText(webhookUrl, "url")}>
                {copied === "url" ? <CheckCircle size={16} /> : <Copy size={16} />}
              </Button>
            </div>
          </div>
          <div>
            <Label>Verify token (Meta webhook)</Label>
            <div className="mt-1 flex gap-2">
              <Input value={String(config?.verify_token ?? "")} readOnly className="bg-gray-50 font-mono text-xs" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyText(String(config?.verify_token ?? ""), "verify")}
              >
                {copied === "verify" ? <CheckCircle size={16} /> : <Copy size={16} />}
              </Button>
            </div>
          </div>
          <a
            href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-green-600"
          >
            Meta WhatsApp Setup Guide <ExternalLink size={14} />
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>100 shops ko kaise setup do</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-700">
          <p>
            Har buyer <strong>apna account</strong> banata hai → onboarding → <strong>apna</strong> Phone Number ID +
            token yahan save karta hai. Agent sirf usi shop ke products, notes, aur chats use karta hai.
          </p>
          <p>
            1. Unhein signup link do:{" "}
            <span className="font-mono text-xs">{typeof window !== "undefined" ? window.location.origin : ""}/signup</span>
          </p>
          <p>2. Products + agent notes unke dashboard pe.</p>
          <p>
            3. Meta webhook (sab ke liye same URL): copy karke unke WhatsApp app pe Callback URL + Verify token lagaao,
            field <strong>messages</strong> subscribe.
          </p>
          <p>
            4. Unka token expire ho to woh khud naya token yahan save karein — aapko code nahi chhedna.
          </p>
          <p className="text-xs text-gray-500">
            Agent off ho ya token fail ho: customer ka message <strong>Conversations</strong> mein save rehta hai. Admin
            wahan se seedha uske WhatsApp pe reply bhej sakta hai.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent ko apna stock kaise sikhao</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-700">
          <p>1. Dashboard → <strong>Products</strong> — har item ka naam + price add karo (Cotton Suit, Lawn, etc.).</p>
          <p>2. Upar <strong>Agent training notes</strong> mein delivery charges, sizes, COD rules likho.</p>
          <p>3. Customer WhatsApp pe bolega “suit chahiye” — agent catalog se match karega.</p>
          <p className="text-xs text-gray-500">
            Agent replies Groq Llama (fast free open-source) se aati hain jab Netlify pe GROQ_API_KEY laga ho. Catalog
            hamesha is dashboard ke Products + notes se aata hai.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
