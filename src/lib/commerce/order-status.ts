import type { OrderStatus } from "@/types/database";

const ALLOWED: Record<string, OrderStatus[]> = {
  draft: ["pending", "cancelled"],
  pending: ["confirmed", "processing", "cancelled"],
  confirmed: ["processing", "preparing", "cancelled"],
  processing: ["preparing", "ready", "out_for_delivery", "cancelled"],
  preparing: ["ready", "out_for_delivery", "cancelled"],
  ready: ["out_for_delivery", "delivered", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
  delivered: ["returned"],
  cancelled: [],
  returned: [],
};

export function canTransitionOrderStatus(from: string, to: string) {
  if (from === to) return true;
  const next = ALLOWED[from] || [];
  return next.includes(to as OrderStatus);
}

export function canCancelOrder(status: string) {
  return ["draft", "pending", "confirmed", "processing", "preparing", "ready"].includes(status);
}

export function canRestoreInventoryOnCancel(status: string) {
  return canCancelOrder(status) || status === "out_for_delivery";
}
