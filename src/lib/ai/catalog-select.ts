import type { ShopProduct } from "@/lib/catalog";
import type { ParsedOrderData } from "@/types/database";

export type CatalogIndexEntry = { n: number; id: string; name: string };

export function buildCatalogIndex(products?: ShopProduct[], limit = 40): CatalogIndexEntry[] {
  return (products || []).slice(0, limit).map((p, i) => ({
    n: i + 1,
    id: String(p.id || p.name),
    name: p.name,
  }));
}

export function attachCatalogIndex(order: ParsedOrderData, products?: ShopProduct[]): ParsedOrderData {
  return { ...order, catalog_index: buildCatalogIndex(products) };
}

const URDU_QTY: Record<string, number> = {
  aik: 1,
  ek: 1,
  one: 1,
  do: 2,
  two: 2,
  teen: 3,
  three: 3,
  char: 4,
  four: 4,
  panch: 5,
  five: 5,
};

export function isAddAnotherIntent(message: string) {
  const t = message.toLowerCase();
  return /\bbhi\b/.test(t) && /(chahiye|add|do|karo|den|lena)/.test(t);
}

export function isCheckoutIntent(message: string) {
  const t = message.toLowerCase().trim();
  return /checkout|order place|place order|order krna|order karna|proceed|checkout karo|order complete karo/.test(
    t
  );
}

export function isDeliveryQuestion(message: string) {
  const t = message.toLowerCase();
  if (/\b(chahiye|order karo|add karo)\b/.test(t) && !/delivery/.test(t)) return false;
  return (
    /delivery (details|detail|info|information|kitni|charges|fee|time|policy|area)|delivery details|delivery kya|delivery sy tumhara|matlab.*delivery/.test(
      t
    ) || /^delivery\??$/.test(t.trim())
  );
}

export function parseCatalogNumber(message: string): number | null {
  const t = message.trim();
  const m =
    t.match(/(?:product|item|option|number|no\.?|#)\s*(\d{1,2})\b/i) ||
    t.match(/\b(\d{1,2})\s*(?:number|no\.?|#)\s*(?:wala|wali|wale)?/i) ||
    t.match(/\b(\d{1,2})\s*(?:wala|wali|wale)\b/i) ||
    t.match(/\b(?:mujhy|mujhe|mujhko)\s+(\d{1,2})\s*(?:bhi|wala|wali)?/i) ||
    t.match(/^(\d{1,2})\s*(?:number|no\.?|#)?\s*(?:wala|wali|wale)?[.!]?$/i) ||
    t.match(/\b(\d{1,2})\s*(?:ki|ka|ke)?\s*(?:photo|tasveer|pic|image|detail)/i);
  const n = m ? parseInt(m[1], 10) : null;
  if (!n || n < 1) return null;
  return n;
}

export function parseIndexAndQuantity(message: string): { index: number; quantity: number } | null {
  const t = message.toLowerCase().trim();
  const ke = t.match(/\b(\d{1,2})\s*(?:ke|ki)\s*(\d{1,4})\b/);
  if (ke) return { index: parseInt(ke[1], 10), quantity: parseInt(ke[2], 10) };
  const pieces = t.match(/(\d{1,4})\s*(?:pieces?|pcs|piece)?\s*(\d{1,2})\s*wale/);
  if (pieces) return { index: parseInt(pieces[2], 10), quantity: parseInt(pieces[1], 10) };
  const urdu = t.match(/\b(aik|ek|do|teen|char|panch|one|two|three|four|five)\s+(\d{1,2})\s*wale/);
  if (urdu) return { index: parseInt(urdu[2], 10), quantity: URDU_QTY[urdu[1]] || 1 };
  return null;
}

export function productFromIndex(
  index: number,
  pending: ParsedOrderData | null | undefined,
  products?: ShopProduct[]
): ShopProduct | null {
  const mapped = pending?.catalog_index?.find((e) => e.n === index);
  if (mapped) {
    const hit =
      (products || []).find((p) => p.id && p.id === mapped.id) ||
      (products || []).find((p) => p.name.toLowerCase() === mapped.name.toLowerCase());
    if (hit) return hit;
  }
  return (products || [])[index - 1] || null;
}

export function isCartBuilding(order: ParsedOrderData | null | undefined) {
  const phase = String(order?.session_phase || "");
  const notes = String(order?.notes || "");
  if (phase === "COLLECTING_CUSTOMER_NAME" || phase === "COLLECTING_ADDRESS" || phase === "COLLECTING_PAYMENT" || phase === "CONFIRMING") {
    return false;
  }
  return phase === "CART_BUILDING" || notes === "cart" || notes === "qty" || Boolean(order?.pending_product_id);
}
