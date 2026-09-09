"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ChatToolbar({
  conversationId,
  agentPaused,
}: {
  conversationId: string;
  agentPaused: boolean;
}) {
  const router = useRouter();
  const [paused, setPaused] = useState(agentPaused);
  const [busy, setBusy] = useState(false);

  async function toggleAgent() {
    setBusy(true);
    const res = await fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_paused: !paused }),
    });
    setBusy(false);
    if (!res.ok) return;
    setPaused(!paused);
    router.refresh();
  }

  async function clearMessages() {
    if (!confirm("Is chat ke saare dashboard messages delete ho jayenge. Confirm?")) return;
    setBusy(true);
    await fetch(`/api/conversations/${conversationId}/messages`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant={paused ? "default" : "outline"} size="sm" className="h-8 text-[11px] sm:text-xs" disabled={busy} onClick={toggleAgent}>
        {paused ? "Auto-reply OFF (sirf ye chat)" : "Auto-reply ON (ye chat)"}
      </Button>
      <Button type="button" variant="outline" size="sm" className="h-8 text-[11px] sm:text-xs" disabled={busy} onClick={clearMessages}>
        Clear messages
      </Button>
    </div>
  );
}

export function DeleteMessageButton({
  conversationId,
  messageId,
}: {
  conversationId: string;
  messageId: string;
}) {
  const router = useRouter();
  async function remove() {
    if (!confirm("Yeh message dashboard se delete?")) return;
    await fetch(`/api/conversations/${conversationId}/messages/${messageId}`, { method: "DELETE" });
    router.refresh();
  }
  return (
    <button type="button" onClick={remove} className="mt-1 text-[10px] underline opacity-70 hover:opacity-100">
      Delete
    </button>
  );
}
