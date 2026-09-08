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
  const [copied, setCopied] = useState(false);
  const webhookUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/whatsapp` : "/api/webhooks/whatsapp";

  useEffect(() => {
    fetch("/api/whatsapp/config")
      .then((r) => r.json())
      .then((d) => setConfig(d.config || {}));
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

  function copyWebhook() {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">WhatsApp AI Agent</h1>
        <p className="text-sm text-gray-500">Ye agent WhatsApp chats ke andar automatically orders manage karta hai</p>
      </div>
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
              onBlur={(e) => saveConfig({ phone_number_id: e.target.value })}
              className="mt-1"
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
          <CardTitle>Agent ko apna stock kaise sikhao</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-700">
          <p>1. Dashboard → <strong>Products</strong> — har item ka naam + price add karo (Cotton Suit, Lawn, etc.).</p>
          <p>2. Upar <strong>Agent training notes</strong> mein delivery charges, sizes, COD rules likho.</p>
          <p>3. Customer WhatsApp pe bolega “suit chahiye” — agent catalog se match karega.</p>
          <p className="text-xs text-gray-500">Bina products ke agent generic jawab dega, kyunke usay pata nahi aap kya bechte ho.</p>
        </CardContent>
      </Card>
    </div>
  );
}
