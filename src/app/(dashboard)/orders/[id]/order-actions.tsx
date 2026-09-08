"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";

export const ORDER_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "ready", label: "Ready to deliver" },
  { value: "out_for_delivery", label: "Out for delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

export function OrderActions({
  orderId,
  currentStatus,
  compact,
}: {
  orderId: string;
  currentStatus: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function updateStatus(status: string) {
    if (status === currentStatus) return;
    setLoading(true);
    setMsg(null);
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_status: status }),
    });
    const data = await res.json();
    setMsg(data.notified ? "Customer ko WhatsApp pe update bhej diya" : "Status save ho gaya (WhatsApp send fail ho sakta hai)");
    router.refresh();
    setLoading(false);
  }

  if (compact) {
    return (
      <select
        value={ORDER_STATUSES.some((s) => s.value === currentStatus) ? currentStatus : "pending"}
        onChange={(e) => updateStatus(e.target.value)}
        disabled={loading}
        className="h-9 max-w-[180px] rounded-lg border border-gray-300 bg-white px-2 text-xs"
      >
        {!ORDER_STATUSES.some((s) => s.value === currentStatus) && (
          <option value={currentStatus}>{currentStatus}</option>
        )}
        {ORDER_STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {ORDER_STATUSES.map((s) => (
          <Button
            key={s.value}
            type="button"
            size="sm"
            variant={currentStatus === s.value ? "default" : "outline"}
            disabled={loading}
            onClick={() => updateStatus(s.value)}
          >
            {s.label}
          </Button>
        ))}
      </div>
      {msg && (
        <p className="flex items-center gap-1 text-xs text-gray-500">
          <MessageCircle size={12} /> {msg}
        </p>
      )}
    </div>
  );
}
