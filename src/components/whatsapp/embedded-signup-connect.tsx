"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { launchWhatsAppEmbeddedSignup } from "@/lib/whatsapp/embedded-signup-client";

export function EmbeddedSignupConnect({
  config,
  onRefresh,
}: {
  config: Record<string, unknown> | null;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connected = Boolean(config?.has_token && config?.phone_number_id);

  async function connect() {
    setError("");
    setBusy(true);
    try {
      const metaRes = await fetch("/api/whatsapp/embedded-signup");
      const meta = await metaRes.json();
      if (!meta.configured || !meta.appId || !meta.configId) {
        throw new Error(
          "Meta Embedded Signup configured nahi. META_APP_ID aur META_EMBEDDED_SIGNUP_CONFIG_ID set karein."
        );
      }

      const { code, session } = await launchWhatsAppEmbeddedSignup({
        appId: meta.appId,
        configId: meta.configId,
        graphVersion: meta.graphVersion || "v26.0",
      });

      const save = await fetch("/api/whatsapp/embedded-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          waba_id: session.waba_id || null,
          phone_number_id: session.phone_number_id || null,
        }),
      });
      const data = await save.json();
      if (!save.ok || data.error) {
        throw new Error(data.error || "Backend ne WhatsApp connect save nahi kiya.");
      }
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Is business ka WhatsApp disconnect karein? Products/orders delete nahi honge.")) return;
    await fetch("/api/whatsapp/disconnect", { method: "POST" });
    onRefresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect WhatsApp</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          Status:{" "}
          {connected ? (
            <span className="font-semibold text-green-700">Connected</span>
          ) : (
            <span className="font-semibold text-red-700">Not Connected</span>
          )}
        </p>
        {connected && (
          <div className="space-y-1 text-gray-700">
            <p>Display: {String(config?.verified_name || config?.display_phone_number || "—")}</p>
            <p>Phone number ID: {String(config?.phone_number_id || "")}</p>
            <p>WABA ID: {String(config?.waba_id || "")}</p>
            <p>AI Agent: {config?.agent_enabled ? "Active" : "Disabled"}</p>
          </div>
        )}
        {!connected ? (
          <Button onClick={connect} disabled={busy}>
            {busy ? "Connecting…" : "Connect WhatsApp"}
          </Button>
        ) : (
          <Button variant="destructive" onClick={disconnect}>
            Disconnect WhatsApp
          </Button>
        )}
        {error && <p className="text-red-700">{error}</p>}
        <p className="text-xs text-gray-500">
          Ye Meta WhatsApp Embedded Signup flow hai (Facebook Login for Business). Popup mein WhatsApp Business
          account / phone number connect karein — sirf Facebook app login nahi.
        </p>
      </CardContent>
    </Card>
  );
}
