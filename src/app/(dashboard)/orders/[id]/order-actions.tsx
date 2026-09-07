"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";

const statuses = ["pending", "confirmed", "preparing", "ready", "out_for_delivery", "delivered", "cancelled"];

export function OrderActions({ orderId, currentStatus }: { orderId: string; currentStatus: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function updateStatus(status: string) {
    setLoading(true);
    const supabase = createClient();
    await supabase.from("orders").update({ order_status: status, updated_at: new Date().toISOString() }).eq("id", orderId);
    router.refresh();
    setLoading(false);
  }

  async function sendWhatsAppUpdate(templateKey: string) {
    setLoading(true);
    await fetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, templateKey }),
    });
    setLoading(false);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <select
        value={currentStatus}
        onChange={(e) => updateStatus(e.target.value)}
        disabled={loading}
        className="h-10 rounded-lg border border-gray-300 px-3 text-sm"
      >
        {statuses.map((s) => (
          <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
        ))}
      </select>
      <Button variant="outline" size="sm" onClick={() => sendWhatsAppUpdate("order_confirmation")} disabled={loading}>
        <MessageCircle size={14} /> WhatsApp Update
      </Button>
    </div>
  );
}
