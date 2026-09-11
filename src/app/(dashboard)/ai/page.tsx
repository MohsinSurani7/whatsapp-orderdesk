"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type Settings = {
  agent_enabled: boolean;
  agent_name: string;
  groq_model: string;
  groq_temperature: number;
  groq_max_tokens: number;
  agent_language: string;
  agent_instructions: string;
  groq_key_masked: string;
  has_groq_key: boolean;
  easypaisa_number: string;
  jazzcash_number: string;
};

type Instruction = { id: string; instruction: string; active: boolean };

export default function AiControlPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [groqInput, setGroqInput] = useState("");
  const [groqTest, setGroqTest] = useState("");
  const [saving, setSaving] = useState(false);
  const [instrInput, setInstrInput] = useState("");
  const [testInput, setTestInput] = useState("");
  const [testHistory, setTestHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [lastTools, setLastTools] = useState<string[]>([]);

  async function load() {
    const res = await fetch("/api/ai/settings");
    const data = await res.json();
    setSettings(data.settings);
    setInstructions(data.instructions || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function save(updates: Record<string, unknown>) {
    setSaving(true);
    await fetch("/api/ai/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    await load();
    setSaving(false);
  }

  async function testGroq() {
    const res = await fetch("/api/ai/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groq_api_key: groqInput }),
    });
    const data = await res.json();
    setGroqTest(data.message || (data.ok ? "OK" : "Failed"));
  }

  async function saveInstruction() {
    const text = instrInput.trim();
    if (!text) return;
    const res = await fetch("/api/ai/instructions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: text }),
    });
    const data = await res.json();
    setInstrInput("");
    setTestHistory((h) => [
      ...h,
      { role: "user", content: text },
      { role: "assistant", content: data.reply || "Instruction saved." },
    ]);
    await load();
  }

  async function sendTest() {
    const message = testInput.trim();
    if (!message) return;
    setTestInput("");
    const history = [...testHistory, { role: "user" as const, content: message }];
    const res = await fetch("/api/ai/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: testHistory, pendingOrder: pending }),
    });
    const data = await res.json();
    setLastTools(data.tools || []);
    setPending(data.parsed_order);
    setTestHistory([...history, { role: "assistant", content: data.reply || "" }]);
  }

  if (!settings) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI Control Center</h1>
        <p className="text-sm text-gray-500">Groq key server-side rehti hai. Customer WhatsApp agent alag hai — Test Agent production orders nahi banata.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>AI Agent</CardTitle>
            <Badge variant={settings.agent_enabled ? "success" : "default"}>{settings.agent_enabled ? "Enabled" : "Disabled"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={() => save({ agent_enabled: !settings.agent_enabled })} disabled={saving}>
            {settings.agent_enabled ? "Disable Agent" : "Enable Agent"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Groq</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>API Key {settings.has_groq_key ? `(saved ${settings.groq_key_masked || "********"})` : ""}</Label>
            <Input type="password" value={groqInput} onChange={(e) => setGroqInput(e.target.value)} placeholder="gsk_…" className="mt-1" />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => save({ groq_api_key: groqInput })} disabled={!groqInput.trim() || saving}>
              Save Key
            </Button>
            <Button variant="outline" onClick={testGroq}>
              Test Connection
            </Button>
            <Button variant="destructive" onClick={() => save({ remove_groq_key: true })}>
              Remove
            </Button>
          </div>
          {groqTest && <p className="text-sm text-gray-700">{groqTest.startsWith("Groq connection successful") ? "✓ " : "✗ "}{groqTest}</p>}
          <div>
            <Label>Model</Label>
            <Input defaultValue={settings.groq_model} onBlur={(e) => save({ groq_model: e.target.value })} className="mt-1" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Temperature</Label>
              <Input type="number" step="0.05" defaultValue={settings.groq_temperature} onBlur={(e) => save({ groq_temperature: Number(e.target.value) })} className="mt-1" />
            </div>
            <div>
              <Label>Max tokens</Label>
              <Input type="number" defaultValue={settings.groq_max_tokens} onBlur={(e) => save({ groq_max_tokens: Number(e.target.value) })} className="mt-1" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Agent name</Label>
            <Input defaultValue={settings.agent_name} onBlur={(e) => save({ agent_name: e.target.value })} className="mt-1" />
          </div>
          <div>
            <Label>Language</Label>
            <select
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              defaultValue={settings.agent_language}
              onChange={(e) => save({ agent_language: e.target.value })}
            >
              <option value="auto">Auto</option>
              <option value="roman_urdu">Roman Urdu</option>
              <option value="urdu">Urdu</option>
              <option value="english">English</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500">Configuration chat — ye production customer cart change nahi karti.</p>
          <textarea
            value={instrInput}
            onChange={(e) => setInstrInput(e.target.value)}
            rows={3}
            placeholder='Example: Customer se hamesha Roman Urdu mein baat karna.'
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <Button onClick={saveInstruction}>Save instruction</Button>
          <ul className="space-y-2 text-sm">
            {instructions.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-2 rounded-lg border border-gray-100 p-2">
                <span>{i.instruction}</span>
                <Button
                  variant="outline"
                  onClick={() => fetch(`/api/ai/instructions?id=${i.id}`, { method: "DELETE" }).then(load)}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
          <div>
            <Label>Business knowledge / system notes</Label>
            <textarea
              defaultValue={settings.agent_instructions}
              onBlur={(e) => save({ agent_instructions: e.target.value })}
              rows={4}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Easypaisa</Label>
              <Input defaultValue={settings.easypaisa_number} onBlur={(e) => save({ easypaisa_number: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>JazzCash</Label>
              <Input defaultValue={settings.jazzcash_number} onBlur={(e) => save({ jazzcash_number: e.target.value })} className="mt-1" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test Agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg bg-gray-50 p-3 text-sm">
            {testHistory.length === 0 && <p className="text-gray-500">Customer messages yahan test karein: products dikhao, 7, 2, 8 wala bhi…</p>}
            {testHistory.map((m, i) => (
              <p key={i} className={m.role === "user" ? "font-medium text-gray-900" : "text-gray-700"}>
                {m.role === "user" ? "You: " : "Agent: "}
                {m.content}
              </p>
            ))}
          </div>
          {lastTools.length > 0 && <p className="text-xs text-gray-500">Tool: {lastTools.join(", ")}</p>}
          <div className="flex gap-2">
            <Input value={testInput} onChange={(e) => setTestInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendTest()} placeholder="products dikhao" />
            <Button onClick={sendTest}>Send</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
