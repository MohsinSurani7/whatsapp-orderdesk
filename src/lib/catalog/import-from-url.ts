import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { uid } from "@/lib/db/store";
import { isSupabaseEnabled, uploadProductImage } from "@/lib/db/supabase-sync";

export type ImportedProductDraft = {
  name: string;
  price: number;
  description: string | null;
  category: string | null;
  sizes: string | null;
  image_url: string | null;
  source_image?: string | null;
};

/** Soft ceiling only for timeouts / free-tier — not a "store can only have 12" rule. */
export const IMPORT_HARD_CAP = 100;

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function isPrivateIp(host: string) {
  if (BLOCKED_HOSTS.has(host)) return true;
  if (/^(10\.|192\.168\.|169\.254\.)/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  return false;
}

export function assertSafePublicUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http/https links allowed");
  }
  if (isPrivateIp(u.hostname)) {
    throw new Error("Private/local URLs allowed nahi");
  }
  return u;
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(base: string, maybe: string) {
  try {
    return new URL(maybe, base).toString();
  } catch {
    return null;
  }
}

function decodeHtmlEntities(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff\s-]/g, " ")
    .split(/[\s_-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^(the|and|for|with|from|rs|pkr|size|new)$/i.test(t));
}

/** Prefer blank image over mismatched photo. */
export function imageLooksTrustedForProduct(name: string, imageUrl: string | null | undefined) {
  if (!imageUrl) return false;
  const url = imageUrl.toLowerCase();
  if (/sprite|icon|logo|favicon|placeholder|avatar|banner|hero|payment|whatsapp|facebook/i.test(url)) {
    return false;
  }
  const tokens = nameTokens(name);
  if (!tokens.length) return true; // no tokens to check — keep if otherwise clean
  const path = (() => {
    try {
      return decodeURIComponent(new URL(imageUrl).pathname.toLowerCase());
    } catch {
      return url;
    }
  })();
  const hits = tokens.filter((t) => path.includes(t)).length;
  if (hits >= 1) return true;
  // CDN hashed filenames often won't include product name — allow only if URL is clearly a product media path
  if (/\/(products?|product|catalog|cdn\/shop|wp-content\/uploads|media\/catalog)\//i.test(path)) {
    return true;
  }
  return false;
}

type BoundCard = {
  name: string;
  price: number | null;
  description: string | null;
  image: string | null;
  confidence: "high" | "medium";
};

function extractImgFromBlock(block: string, pageUrl: string) {
  const attrs =
    block.match(/<img\b[^>]*>/i)?.[0] ||
    "";
  const src =
    attrs.match(/(?:data-src|data-original|data-lazy-src|src)=["']([^"']+)["']/i)?.[1] ||
    null;
  if (!src || /sprite|icon|logo|favicon|placeholder|1x1|pixel/i.test(src)) return null;
  return absoluteUrl(pageUrl, src.trim());
}

function extractPriceFromBlock(block: string) {
  const text = decodeHtmlEntities(block.replace(/<[^>]+>/g, " "));
  const m =
    text.match(/(?:Rs\.?|PKR|USD|\$)\s*([0-9]{2,7}(?:[.,][0-9]{2})?)/i) ||
    text.match(/\b([0-9]{3,7})\s*(?:Rs\.?|PKR)\b/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractNameFromBlock(block: string) {
  const candidates = [
    block.match(/<(?:h[1-4]|a)[^>]*>([^<]{2,120})<\/(?:h[1-4]|a)>/i)?.[1],
    block.match(/class=["'][^"']*(?:product[_-]?title|woocommerce-loop-product__title|card-title)[^"']*["'][^>]*>([^<]{2,120})</i)?.[1],
    block.match(/itemprop=["']name["'][^>]*>([^<]{2,120})</i)?.[1],
    block.match(/alt=["']([^"']{2,120})["']/i)?.[1],
  ];
  for (const c of candidates) {
    const name = decodeHtmlEntities(String(c || ""));
    if (name.length >= 2 && !/add to cart|quick view|sale|new arrival/i.test(name)) return name;
  }
  return null;
}

/**
 * Parse product cards as bound units (name+price+image from SAME HTML block)
 * so Groq cannot freely remix a global image list.
 */
export function extractBoundProductCards(html: string, pageUrl: string): BoundCard[] {
  const cards: BoundCard[] = [];
  const seen = new Set<string>();

  const patterns = [
    /<(?:li|article|div)[^>]*class=["'][^"']*(?:product(?:-card|_item| card)|grid-product|woocommerce|product-item|collection-product)[^"']*["'][^>]*>[\s\S]*?<\/(?:li|article|div)>/gi,
    /<(?:li|article)[^>]*(?:itemtype=["'][^"']*Product["']|data-product-id=)[^>]*>[\s\S]*?<\/(?:li|article)>/gi,
  ];

  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      const block = m[0];
      if (block.length > 25000) continue;
      const name = extractNameFromBlock(block);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const image = extractImgFromBlock(block, pageUrl);
      const price = extractPriceFromBlock(block);
      const descRaw =
        block.match(/<(?:p|span)[^>]*class=["'][^"']*(?:description|excerpt|subtitle)[^"']*["'][^>]*>([^<]{5,300})</i)?.[1] ||
        null;
      cards.push({
        name: name.slice(0, 120),
        price,
        description: descRaw ? decodeHtmlEntities(descRaw).slice(0, 400) : null,
        image,
        confidence: image && price != null ? "high" : "medium",
      });
      if (cards.length >= IMPORT_HARD_CAP) return cards;
    }
  }
  return cards;
}

function extractJsonLdProducts(html: string) {
  const products: Array<{ name?: string; price?: number; description?: string; image?: string }> = [];
  const scripts = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const s of scripts) {
    try {
      const json = JSON.parse(s[1].trim());
      const nodes = Array.isArray(json) ? json : json["@graph"] ? json["@graph"] : [json];
      for (const node of nodes) {
        walkJsonLdNode(node, products);
      }
    } catch {
      /* ignore bad json-ld */
    }
  }
  return products;
}

function walkJsonLdNode(
  node: unknown,
  products: Array<{ name?: string; price?: number; description?: string; image?: string }>
) {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  if (Array.isArray(n)) {
    for (const child of n) walkJsonLdNode(child, products);
    return;
  }
  const type = String(n["@type"] || "");
  if (/ItemList/i.test(type) && Array.isArray(n.itemListElement)) {
    for (const el of n.itemListElement) {
      const item = (el as { item?: unknown })?.item ?? el;
      walkJsonLdNode(item, products);
    }
  }
  if (/Product/i.test(type)) {
    const offer = Array.isArray(n.offers) ? n.offers[0] : n.offers;
    const offerObj = offer && typeof offer === "object" ? (offer as Record<string, unknown>) : null;
    const price = offerObj?.price != null ? Number(offerObj.price) : NaN;
    const image = Array.isArray(n.image) ? n.image[0] : n.image;
    products.push({
      name: n.name ? String(n.name) : undefined,
      price: Number.isFinite(price) ? price : undefined,
      description: n.description ? String(n.description).slice(0, 400) : undefined,
      image: image ? String(image) : undefined,
    });
  }
  if (Array.isArray(n["@graph"])) {
    for (const child of n["@graph"]) walkJsonLdNode(child, products);
  }
}

/**
 * Only keep an image if it is already bound to this product OR clearly matches the name.
 * Never steal another product's image from a flat global list.
 */
export function trustImageForDraft(
  name: string,
  candidate: string | null | undefined,
  boundByName: Map<string, string>
) {
  const key = name.toLowerCase();
  const bound = boundByName.get(key);
  if (bound) return bound;
  if (!candidate) return null;
  if (imageLooksTrustedForProduct(name, candidate)) return candidate;
  return null;
}

async function saveImageBytes(bytes: Buffer, contentType: string, extHint: string) {
  const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extHint) ? extHint : ".jpg";
  const filename = `${uid()}${safeExt}`;
  if (isSupabaseEnabled()) {
    return uploadProductImage(filename, bytes, contentType || "image/jpeg");
  }
  const dir = path.join(process.cwd(), "public", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), bytes);
  return `/uploads/${filename}`;
}

export async function downloadAndStoreImage(imageUrl: string, pageUrl: string) {
  const abs = absoluteUrl(pageUrl, imageUrl) || imageUrl;
  assertSafePublicUrl(abs);
  const res = await fetch(abs, {
    headers: {
      "User-Agent": "OrderDeskBot/1.0 (+product-import)",
      Accept: "image/*,*/*",
      Referer: pageUrl,
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return null;
  const ctype = res.headers.get("content-type") || "image/jpeg";
  if (!ctype.startsWith("image/")) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 800 || buf.length > 6_000_000) return null;
  let ext = ".jpg";
  if (ctype.includes("png")) ext = ".png";
  else if (ctype.includes("webp")) ext = ".webp";
  else if (ctype.includes("gif")) ext = ".gif";
  else {
    const fromUrl = path.extname(new URL(abs).pathname).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(fromUrl)) ext = fromUrl;
  }
  return saveImageBytes(buf, ctype, ext);
}

function groqModels() {
  return [
    process.env.GROQ_MODEL,
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
  ].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);
}

export async function fetchPageHtml(url: string) {
  const safe = assertSafePublicUrl(url);
  const res = await fetch(safe.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; OrderDeskBot/1.0; +https://wtsapp-orderdesk.netlify.app)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Website fetch failed (${res.status})`);
  const htmlRaw = await res.text();
  const html = htmlRaw.length > 900_000 ? htmlRaw.slice(0, 900_000) : htmlRaw;
  return { html, finalUrl: res.url || safe.toString() };
}

function parseProductsJson(raw: string) {
  let parsed: { products?: unknown[]; has_more?: boolean } = {};
  try {
    parsed = JSON.parse(raw) as { products?: unknown[]; has_more?: boolean };
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    parsed =
      start >= 0 && end > start
        ? (JSON.parse(raw.slice(start, end + 1)) as { products?: unknown[]; has_more?: boolean })
        : {};
  }
  return parsed;
}

function rowToDraft(row: Record<string, unknown>): ImportedProductDraft | null {
  const name = String(row.name || "").trim();
  if (!name || name.length < 2) return null;
  const price = Number(row.price);
  const description = row.description ? String(row.description).slice(0, 400).trim() : null;
  return {
    name: name.slice(0, 120),
    price: Number.isFinite(price) && price >= 0 ? price : 0,
    description: description && description.length >= 8 ? description : null,
    category: row.category ? String(row.category).slice(0, 60) : null,
    sizes: row.sizes ? String(row.sizes).slice(0, 80) : null,
    image_url: null,
    source_image: row.image_url ? String(row.image_url) : null,
  };
}

function chunkText(text: string, size: number) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks.length ? chunks : [""];
}

async function groqExtractBatch(params: {
  client: OpenAI;
  pageUrl: string;
  textChunk: string;
  boundCards: BoundCard[];
  jsonLd: unknown[];
  excludeNames: string[];
  batchHint: number;
}) {
  const system = `You extract shop products for a Pakistan WhatsApp store dashboard.
Return ONLY JSON: {"products":[{"name":"","price":0,"description":"","category":"","sizes":"","image_url":""}],"has_more":false}

CRITICAL accuracy rules (never break these):
1) Each product object must be ONE real product. name, price, description, image_url MUST belong to the SAME product.
2) NEVER mix: do not put Product A's photo/description on Product B.
3) Prefer BOUND_PRODUCT_CARDS and JSON_LD — those fields are already correctly paired. Copy them as-is when present.
4) image_url: ONLY use the image already listed on that same card/json-ld row. If unsure, use "" (blank is better than wrong).
5) description: ONLY text clearly about THAT product. If unsure, use "".
6) Do NOT invent products, prices, or images. Skip nav/blog/footer/testimonials.
7) If EXCLUDE_NAMES already has a product, skip it.
8) has_more=true only if more NEW products still exist in this chunk.`;

  const user = `PAGE_URL: ${params.pageUrl}
EXCLUDE_NAMES: ${JSON.stringify(params.excludeNames.slice(0, 80))}
BOUND_PRODUCT_CARDS (trusted pairs — copy carefully): ${JSON.stringify(params.boundCards.slice(0, 60))}
JSON_LD_PRODUCTS (trusted pairs): ${JSON.stringify(params.jsonLd)}
PAGE_TEXT_CHUNK (use only to fill missing name/price when card incomplete; do not invent images from random text): ${params.textChunk}
Aim for up to ${params.batchHint} products if they exist.`;

  let raw = "{}";
  let lastErr: unknown = null;
  for (const model of groqModels()) {
    try {
      const completion = await params.client.chat.completions.create(
        {
          model,
          temperature: 0.1,
          max_tokens: 8000,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
        { timeout: 45000 }
      );
      raw = completion.choices[0]?.message?.content || "{}";
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const msg = String((err as { message?: string })?.message || err);
      if (!/model_not_found|does not exist|404|not have access/i.test(msg)) throw err;
    }
  }
  if (lastErr) throw lastErr;
  return parseProductsJson(raw);
}

export async function extractProductsWithGroq(params: {
  groqApiKey: string;
  pageUrl: string;
  html: string;
  maxProducts?: number;
}): Promise<ImportedProductDraft[]> {
  const hardCap = Math.min(Math.max(params.maxProducts ?? IMPORT_HARD_CAP, 1), IMPORT_HARD_CAP);
  const fullText = stripHtml(params.html).slice(0, 60000);
  const jsonLd = extractJsonLdProducts(params.html);
  const boundCards = extractBoundProductCards(params.html, params.pageUrl);

  const boundImageByName = new Map<string, string>();
  for (const c of boundCards) {
    if (c.image) boundImageByName.set(c.name.toLowerCase(), c.image);
  }
  for (const p of jsonLd) {
    if (p.name && p.image) {
      const key = p.name.toLowerCase();
      if (!boundImageByName.has(key)) boundImageByName.set(key, p.image);
    }
  }

  const client = new OpenAI({
    apiKey: params.groqApiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });

  const drafts: ImportedProductDraft[] = [];
  const seen = new Set<string>();

  const pushDraft = (d: ImportedProductDraft | null, preferBoundImage = true) => {
    if (!d || drafts.length >= hardCap) return;
    const key = d.name.toLowerCase();
    if (seen.has(key)) return;
    const trusted = preferBoundImage
      ? trustImageForDraft(d.name, d.source_image, boundImageByName)
      : d.source_image && imageLooksTrustedForProduct(d.name, d.source_image)
        ? d.source_image
        : trustImageForDraft(d.name, null, boundImageByName);
    seen.add(key);
    drafts.push({ ...d, source_image: trusted });
  };

  // 1) Trusted structured sources first (correct name↔image↔price pairing)
  for (const p of jsonLd) {
    if (!p.name) continue;
    pushDraft({
      name: p.name.slice(0, 120),
      price: p.price ?? 0,
      description: p.description?.slice(0, 400) || null,
      category: null,
      sizes: null,
      image_url: null,
      source_image: p.image || null,
    });
  }
  for (const c of boundCards) {
    pushDraft({
      name: c.name,
      price: c.price ?? 0,
      description: c.description,
      category: null,
      sizes: null,
      image_url: null,
      source_image: c.image,
    });
  }

  // 2) Groq only fills gaps / remaining products — still validated against bound map
  const textChunks = chunkText(fullText, 14000).slice(0, 5);
  for (let ci = 0; ci < textChunks.length && drafts.length < hardCap; ci++) {
    for (let pass = 0; pass < 4 && drafts.length < hardCap; pass++) {
      const excludeNames = [...seen];
      const parsed = await groqExtractBatch({
        client,
        pageUrl: params.pageUrl,
        textChunk: textChunks[ci],
        boundCards: boundCards.filter((c) => !seen.has(c.name.toLowerCase())),
        jsonLd: ci === 0 && pass === 0 ? jsonLd.filter((p) => p.name && !seen.has(p.name.toLowerCase())).slice(0, 80) : [],
        excludeNames,
        batchHint: 40,
      });
      const list = Array.isArray(parsed.products) ? parsed.products : [];
      let addedThisPass = 0;
      for (const row of list) {
        const before = drafts.length;
        pushDraft(rowToDraft(row as Record<string, unknown>));
        if (drafts.length > before) addedThisPass += 1;
      }
      if (!addedThisPass || parsed.has_more !== true) break;
    }
  }

  return drafts;
}
