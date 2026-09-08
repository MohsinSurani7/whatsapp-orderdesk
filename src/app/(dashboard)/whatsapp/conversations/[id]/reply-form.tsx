"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ReplyForm({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setLoading(true);
    await fetch(`/api/conversations/${conversationId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setText("");
    setLoading(false);
    router.refresh();
  }

  return (
    <form onSubmit={send} className="flex gap-2">
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply on WhatsApp..." />
      <Button type="submit" disabled={loading}>{loading ? "..." : "Send"}</Button>
    </form>
  );
}
