export function money(n: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

export function lineSubtotal(quantity: number, unitPrice: number) {
  return money(Math.max(0, quantity) * Math.max(0, unitPrice));
}

export function calculateOrderTotals(params: {
  items: Array<{ quantity: number; unit_price: number | null }>;
  deliveryFee?: number | null;
  discount?: number | null;
  tax?: number | null;
}) {
  const subtotal = money(
    params.items.reduce((s, i) => s + lineSubtotal(i.quantity, i.unit_price ?? 0), 0)
  );
  const discount = money(Math.max(0, params.discount ?? 0));
  const delivery_fee = money(Math.max(0, params.deliveryFee ?? 0));
  const tax = money(Math.max(0, params.tax ?? 0));
  const total = money(Math.max(0, subtotal - discount + delivery_fee + tax));
  return { subtotal, discount, delivery_fee, tax, total };
}
