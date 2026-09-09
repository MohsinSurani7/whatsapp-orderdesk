export type ShopProduct = {
  id?: string;
  name: string;
  price: number;
  description?: string;
  image_url?: string | null;
  category?: string | null;
  sizes?: string | null;
};

export const DESC_PREVIEW_LEN = 90;

export function parseSizeOptions(raw?: string | null): string[] {
  if (!raw?.trim()) return [];
  const t = raw.trim();
  const range = t.match(/^(\d+)\s*(?:-|–|to|se)\s*(\d+)$/i);
  if (range) {
    const a = parseInt(range[1], 10);
    const b = parseInt(range[2], 10);
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    const out: string[] = [];
    for (let i = start; i <= end && out.length < 24; i++) out.push(String(i));
    return out;
  }
  return t
    .split(/[,/|]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 24);
}

export function uniqueCategories(products: ShopProduct[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const p of products) {
    const c = (p.category || "").trim();
    if (!c) continue;
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(c);
  }
  return list;
}

export function productsInCategory(products: ShopProduct[], category: string): ShopProduct[] {
  const key = category.trim().toLowerCase();
  if (!key || key === "all") return products;
  const exact = products.filter((p) => (p.category || "").trim().toLowerCase() === key);
  if (exact.length) return exact;
  // soft match on name/description for virtual categories like Shoes
  return products.filter((p) =>
    `${p.name} ${p.category || ""} ${p.description || ""}`.toLowerCase().includes(key)
  );
}

export function truncateText(text: string, max = DESC_PREVIEW_LEN) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trim()}…`;
}

export function descriptionPreview(description?: string | null) {
  if (!description?.trim()) return "";
  return truncateText(description, DESC_PREVIEW_LEN);
}

export function needsSeeMore(description?: string | null) {
  return Boolean(description && description.trim().length > DESC_PREVIEW_LEN);
}

export function formatProductCard(p: ShopProduct, opts?: { full?: boolean }) {
  const sizes = parseSizeOptions(p.sizes);
  const desc = opts?.full
    ? p.description?.trim() || ""
    : descriptionPreview(p.description);
  return [
    `📦 *${p.name}*`,
    p.category ? `🏷️ ${p.category}` : null,
    `💰 Rs.${p.price}`,
    desc ? `📝 ${desc}` : null,
    sizes.length ? `👟 Size: ${sizes.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function catalogSummary(products: ShopProduct[], limit = 8) {
  return products
    .slice(0, limit)
    .map((p, i) => {
      const sizes = parseSizeOptions(p.sizes);
      const sizeBit = sizes.length ? ` · size ${sizes[0]}-${sizes[sizes.length - 1]}` : "";
      return `${i + 1}) ${p.name} — Rs.${p.price}${p.category ? ` (${p.category})` : ""}${sizeBit}`;
    })
    .join("\n");
}

export function findProductById(products: ShopProduct[], id: string) {
  return products.find((p) => p.id === id) || null;
}

export function stripPhotoTalk(text: string) {
  return text
    .replace(/^[^\n]*(photo|tasveer|image|pic)[^\n]*(bhej|send|attach)[^\n]*$/gim, "")
    .replace(/photos?\s+sath[^\n]*/gi, "")
    .replace(/photo neeche[^\n]*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isCompletedSale(status: string) {
  return status === "delivered";
}

export function isCancelledSale(status: string) {
  return status === "cancelled" || status === "returned";
}
