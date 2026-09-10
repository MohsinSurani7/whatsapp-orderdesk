import { money } from "@/lib/commerce/money";

export type CartLine = {
  product_id?: string | null;
  sku?: string | null;
  name: string;
  quantity: number;
  variant: string | null;
  unit_price: number | null;
};

function keyOf(line: CartLine) {
  const id = (line.product_id || "").trim().toLowerCase();
  const name = line.name.trim().toLowerCase();
  const variant = (line.variant || "").trim().toLowerCase();
  return `${id || name}::${variant}`;
}

export function addCartLine(lines: CartLine[], incoming: CartLine): CartLine[] {
  const qty = Math.max(1, Math.floor(Number(incoming.quantity) || 1));
  const next = incoming.product_id
    ? { ...incoming, quantity: qty }
    : { ...incoming, quantity: qty };
  const k = keyOf(next);
  const out = lines.map((l) => ({ ...l }));
  const idx = out.findIndex((l) => keyOf(l) === k);
  if (idx >= 0) {
    out[idx] = {
      ...out[idx],
      ...next,
      quantity: out[idx].quantity + qty,
      unit_price: next.unit_price ?? out[idx].unit_price,
    };
    return out;
  }
  return [...out, next];
}

export function setCartLineQty(lines: CartLine[], match: Partial<CartLine>, quantity: number): CartLine[] {
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  return lines
    .map((l) => {
      const sameId = match.product_id && l.product_id && l.product_id === match.product_id;
      const sameName = match.name && l.name.toLowerCase() === match.name.toLowerCase();
      if (!sameId && !sameName) return l;
      if (match.variant != null && (l.variant || "") !== match.variant) return l;
      return { ...l, quantity: qty };
    })
    .filter((l) => l.quantity > 0);
}

export function removeCartLine(lines: CartLine[], match: Partial<CartLine>): CartLine[] {
  return lines.filter((l) => {
    const sameId = match.product_id && l.product_id && l.product_id === match.product_id;
    const sameName = match.name && l.name.toLowerCase() === match.name.toLowerCase();
    if (!sameId && !sameName) return true;
    if (match.variant != null && (l.variant || "") !== match.variant) return true;
    return false;
  });
}

export function cartFingerprint(lines: CartLine[]) {
  return lines
    .map((l) => `${l.product_id || l.name}:${l.variant || ""}:${l.quantity}:${l.unit_price ?? ""}`)
    .sort()
    .join("|");
}

export function formatCartLines(lines: CartLine[], currency = "Rs.") {
  return lines
    .map((l, i) => {
      const price = l.unit_price != null ? ` — ${currency}${money(l.unit_price)}` : "";
      const variant = l.variant ? ` (${l.variant})` : "";
      return `${i + 1}. ${l.quantity}x ${l.name}${variant}${price}`;
    })
    .join("\n");
}
