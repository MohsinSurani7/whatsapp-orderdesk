"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Bot, CheckCircle, Copy, ExternalLink, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function WhatsAppAgentPage() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [businessId, setBusinessId] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/webhooks/whatsapp`
    : "/api/webhooks/whatsapp";

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: member } = await supabase
        .from("business_members")
        .select("business_id")
        .eq("user_id", user.id)
        .single();

      if (!member) return;
      setBusinessId(member.business_id);

      const { data } = await supabase
        .from("whatsapp_configs")
        .select("*")
        .eq("business_id", member.business_id)
        .single();

      setConfig(data);
    }
    load();
  }, []);

  async function saveConfig(updates: Record<string, unknown>) {
    setSaving(true);
    const supabase = createClient();
    await supabase
      .from("whatsapp_configs")
      .update(updates)
      .eq("business_id", businessId);
    setConfig((prev) => ({ ...prev, ...updates }));
    setSaving(false);
  }

  function copyWebhook() {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">WhatsApp AI Agent</h1>
        <p className="text-sm text-gray-500">
          Ye agent WhatsApp chats ke andar automatically orders manage karta hai
        </p>
      </div>

      {/* Agent Status */}
      <Card className="border-green-200">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-600">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle>AI Agent Status</CardTitle>
              <p className="text-sm text-gray-500">Automatically replies and creates orders in WhatsApp</p>
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
            <Label>Greeting Message</Label>
            <textarea
              defaultValue={String(config?.agent_greeting ?? "")}
              onBlur={(e) => saveConfig({ agent_greeting: e.target.value })}
              rows={3}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
            />
          </div>
        </CardContent>
      </Card>

      {/* What Agent Does */}
      <Card>
        <CardHeader>
          <CardTitle>Agent Automatically Handles</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              "New customer greetings",
              "Order taking (multi-turn conversation)",
              "Order confirmation",
              "Order status queries",
              "Product inquiries",
              "Payment & delivery questions",
              "Auto-create orders in dashboard",
              "Human handoff when needed",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2 text-sm text-gray-700">
                <CheckCircle size={16} className="shrink-0 text-green-600" />
                {item}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* WhatsApp API Setup */}
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp Cloud API Connection</CardTitle>
          <p className="text-sm text-gray-500">Meta Business Platform se connect karein taake agent live ho</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Phone Number ID</Label>
            <Input
              defaultValue={String(config?.phone_number_id ?? "")}
              onBlur={(e) => saveConfig({ phone_number_id: e.target.value })}
              placeholder="From Meta Developer Console"
              className="mt-1"
            />
          </div>
          <div>
            <Label>WhatsApp Business Account ID</Label>
            <Input
              defaultValue={String(config?.waba_id ?? "")}
              onBlur={(e) => saveConfig({ waba_id: e.target.value })}
              placeholder="WABA ID"
              className="mt-1"
            />
          </div>
          <div>
            <Label>Access Token</Label>
            <Input
              type="password"
              defaultValue={String(config?.access_token ?? "")}
              onBlur={(e) => saveConfig({ access_token: e.target.value })}
              placeholder="Permanent access token"
              className="mt-1"
            />
          </div>
          <div>
            <Label>Verify Token</Label>
            <Input
              defaultValue={String(config?.verify_token ?? "")}
              readOnly
              className="mt-1 bg-gray-50"
            />
          </div>
          <div>
            <Label>Webhook URL</Label>
            <div className="mt-1 flex gap-2">
              <Input value={webhookUrl} readOnly className="bg-gray-50 font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copyWebhook}>
                {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
              </Button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Meta Developer Console mein ye URL webhook ke tor pe set karein
            </p>
          </div>
          <a
            href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-green-600 hover:text-green-700"
          >
            Meta WhatsApp Setup Guide <ExternalLink size={14} />
          </a>
        </CardContent>
      </Card>

      {/* Flow diagram */}
      <Card>
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            {[
              "Customer WhatsApp pe message bhejta hai",
              "Meta webhook hamare AI agent ko trigger karta hai",
              "AI samajhta hai — order, status, ya general query",
              "Agent automatically reply bhejta hai WhatsApp pe",
              "Order confirm hone pe dashboard mein auto-create hota hai",
              "Aap dashboard se delivery/payment updates bhej sakte hain",
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-700">
                  {i + 1}
                </div>
                <p className="text-gray-700">{step}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
