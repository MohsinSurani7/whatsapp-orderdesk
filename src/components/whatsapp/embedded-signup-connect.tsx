"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  launchWhatsAppEmbeddedSignup,
  loadMetaSdk,
  type EmbeddedSignupMeta,
} from "@/lib/whatsapp/embedded-signup-client";

export function EmbeddedSignupConnect({
  config,
  onRefresh,
}: {
  config: Record<string, unknown> | null;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sdkReady, setSdkReady] = useState(false);
  const metaRef = useRef<EmbeddedSignupMeta | null>(null);
  const connected = Boolean(config?.has_token && config?.phone_number_id);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const metaRes = await fetch("/api/whatsapp/embedded-signup");
        const meta = await metaRes.json();
        if (!meta.configured || !meta.appId || !meta.configId) return;
        const packed: EmbeddedSignupMeta = {
          appId: meta.appId,
          configId: meta.configId,
          graphVersion: meta.graphVersion || "v26.0",
        };
        metaRef.current = packed;
        await loadMetaSdk(packed);
        if (!cancelled) setSdkReady(true);
      } catch {
        if (!cancelled) setSdkReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function connect() {
    setError("");
    const meta = metaRef.current;
    if (!meta || !window.FB) {
      setError("Facebook SDK ready nahi. Page refresh karke dubara Connect dabayein.");
      return;
    }

    setBusy(true);
    launchWhatsAppEmbeddedSignup(meta)
      .then(async ({ code, session }) => {
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
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
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
          <Button onClick={connect} disabled={busy || !sdkReady}>
            {busy ? "Connecting…" : sdkReady ? "Connect WhatsApp" : "Loading Facebook SDK…"}
          </Button>
        ) : (
          <Button variant="destructive" onClick={disconnect}>
            Disconnect WhatsApp
          </Button>
        )}
        {error && <p className="text-red-700">{error}</p>}
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 space-y-2">
          <p className="font-semibold">Ye errors Meta app dashboard se aate hain, code se nahi:</p>
          <p>
            <strong>App not active</strong> = app Development mode mein hai. Dusra Facebook account tabhi connect ho
            sakta hai jab woh App Roles mein Admin/Developer/Tester ho, ya app <strong>Live</strong> ho.
          </p>
          <p>
            <strong>Sorry, something went wrong</strong> = Embedded Signup config galat hai, app type Business nahi,
            ya domain allow nahi.
          </p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>
              Meta Developers → App → top toggle <strong>Live</strong> (Privacy Policy URL + App Mode Live). Testing
              ke liye dusre account ko <strong>App Roles → Testers</strong> add karein.
            </li>
            <li>App type <strong>Business</strong> hona chahiye (Consumer/Personal nahi).</li>
            <li>Products: WhatsApp + Facebook Login for Business.</li>
            <li>
              Facebook Login for Business → Configurations → template{" "}
              <strong>WhatsApp Embedded Signup</strong> (v4). Jo Config ID mile woh{" "}
              <code>META_EMBEDDED_SIGNUP_CONFIG_ID</code> mein daalein.
            </li>
            <li>
              Facebook Login → Settings: Client OAuth, Web OAuth, Login with JavaScript SDK ON. Allowed domains + Valid
              OAuth Redirect URIs:
              <br />
              <code>https://wtsapp-orderdesk.netlify.app</code>
              <br />
              <code>https://wtsapp-orderdesk.netlify.app/</code>
            </li>
            <li>
              App Dashboard → WhatsApp → Embedded Signup Builder se test karein. Wahan bhi same error aaye to problem
              100% Meta config hai.
            </li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
