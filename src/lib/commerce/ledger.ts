import type { DatabaseShape, LocalProduct } from "@/lib/db/store";
import { nowIso, uid } from "@/lib/db/store";

export type InventoryTxnType =
  | "purchase"
  | "sale"
  | "reservation"
  | "reservation_release"
  | "cancel"
  | "return"
  | "adjustment"
  | "restock"
  | "damage"
  | "manual";

export function recordInventoryTxn(
  db: DatabaseShape,
  params: {
    businessId: string;
    productId: string;
    type: InventoryTxnType;
    quantity: number;
    previousStock: number | null;
    newStock: number | null;
    referenceType?: string | null;
    referenceId?: string | null;
    actorType?: string;
    actorId?: string | null;
    reason?: string | null;
  }
) {
  db.inventory_transactions = db.inventory_transactions || [];
  db.inventory_transactions.push({
    id: uid(),
    business_id: params.businessId,
    product_id: params.productId,
    variant_id: null,
    type: params.type,
    quantity: params.quantity,
    reference_type: params.referenceType ?? null,
    reference_id: params.referenceId ?? null,
    previous_stock: params.previousStock,
    new_stock: params.newStock,
    actor_type: params.actorType ?? "system",
    actor_id: params.actorId ?? null,
    reason: params.reason ?? null,
    created_at: nowIso(),
  });
}

export function applyStockDelta(
  product: LocalProduct,
  delta: number
): { previous: number | null; next: number | null; ok: boolean } {
  if (product.stock == null) return { previous: null, next: null, ok: true };
  const previous = product.stock;
  const next = previous + delta;
  if (next < 0) return { previous, next: previous, ok: false };
  product.stock = next;
  return { previous, next, ok: true };
}
