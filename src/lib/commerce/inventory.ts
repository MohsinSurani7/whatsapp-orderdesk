import type { LocalProduct } from "@/lib/db/store";

export type StockError = {
  code: "OUT_OF_STOCK" | "INSUFFICIENT_STOCK" | "PRODUCT_INACTIVE" | "PRODUCT_NOT_FOUND";
  productName: string;
  available: number;
  requested: number;
};

export function deductStock(
  products: LocalProduct[],
  items: Array<{ product_id?: string | null; name: string; quantity: number }>,
  businessId: string
): { ok: true; products: LocalProduct[] } | { ok: false; error: StockError; products: LocalProduct[] } {
  const next = products.map((p) => ({ ...p }));
  for (const item of items) {
    const qty = Math.max(0, Math.floor(item.quantity));
    if (!qty) continue;
    const hit = next.find(
      (p) =>
        p.business_id === businessId &&
        (item.product_id ? p.id === item.product_id : p.name.toLowerCase() === item.name.toLowerCase())
    );
    if (!hit) {
      return {
        ok: false,
        products,
        error: { code: "PRODUCT_NOT_FOUND", productName: item.name, available: 0, requested: qty },
      };
    }
    if (!hit.is_active) {
      return {
        ok: false,
        products,
        error: { code: "PRODUCT_INACTIVE", productName: hit.name, available: 0, requested: qty },
      };
    }
    if (hit.stock == null) continue;
    if (hit.stock < qty) {
      return {
        ok: false,
        products,
        error: {
          code: hit.stock <= 0 ? "OUT_OF_STOCK" : "INSUFFICIENT_STOCK",
          productName: hit.name,
          available: hit.stock,
          requested: qty,
        },
      };
    }
    hit.stock -= qty;
  }
  return { ok: true, products: next };
}

export function restoreStock(
  products: LocalProduct[],
  items: Array<{ product_id?: string | null; name: string; quantity: number }>,
  businessId: string
) {
  const next = products.map((p) => ({ ...p }));
  for (const item of items) {
    const qty = Math.max(0, Math.floor(item.quantity));
    if (!qty) continue;
    const hit = next.find(
      (p) =>
        p.business_id === businessId &&
        (item.product_id ? p.id === item.product_id : p.name.toLowerCase() === item.name.toLowerCase())
    );
    if (hit && hit.stock != null) hit.stock += qty;
  }
  return next;
}
