import OpenAI from "openai";
import type { AgentResponse, ParsedOrderData, PaymentStatus } from "@/types/database";

const SYSTEM_PROMPT = `You are a WhatsApp order assistant for a small business in Pakistan.
Reply in short Roman Urdu / English mix. Always return JSON only.`;

type CatalogProduct = {
  name: string;
  price: number;
  description?: string;
  image_url?: string | null;
};

function looksLikeRealKey(key?: string) {
  if (!key) return false;
  if (/your-|placeholder|example|changeme/i.test(key)) return false;
  return /^(sk-|gsk_|AIza)/.test(key);
}

function getAIClient() {
  const groq = process.env.GROQ_API_KEY;
  if (looksLikeRealKey(groq)) {
    return new OpenAI({ apiKey: groq, baseURL: "https://api.groq.com/openai/v1" });
  }
  const key = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (looksLikeRealKey(key)) {
    return new OpenAI({
      apiKey: key,
      baseURL: process.env.AI_BASE_URL || undefined,
    });
  }
  return null;
}

export async function processAgentMessage(params: {
  message: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  businessName: string;
  agentName: string;
  products?: CatalogProduct[];
  pendingOrder?: Record<string, unknown> | null;
  customerName?: string | null;
  instructions?: string | null;
  referredProduct?: CatalogProduct | null;
  orderStats?: OrderStats;
}): Promise<AgentResponse> {
  return localAgent(params);
}

type OrderStats = {
  total: number;
  delivered: number;
  pending: number;
  customerTotal: number;
};

function catalogLine(products?: CatalogProduct[]) {
  if (!products?.length) return "";
  return products
    .map((p, i) => {
      const desc = p.description ? `\n   ${p.description}` : "";
      return `${i + 1}) ${p.name} — Rs.${p.price}${desc}`;
    })
    .join("\n");
}

function emptyCatalogReply(businessName: string) {
  return `Assalam o Alaikum! ${businessName} ki taraf se.\n\nAbhi dashboard pe koi product add nahi hai, is liye list / photos / order nahi le sakta.\n\nMalik: Dashboard → Products pe naam + price (+ photo) add karein. Add hote hi main WhatsApp pe catalog bhej dunga.`;
}

function catalogReply(businessName: string, products?: CatalogProduct[]) {
  const catalog = catalogLine(products);
  if (!catalog) return emptyCatalogReply(businessName);
  return `${businessName} ke available products:\n${catalog}\n\nOrder: product ka naam + quantity (jaise "2x Cotton Suit").\nPhotos: "photo bhejo".`;
}

function localAgent(params: {
  message: string;
  pendingOrder?: Record<string, unknown> | null;
  products?: CatalogProduct[];
  customerName?: string | null;
  businessName: string;
  instructions?: string | null;
  referredProduct?: CatalogProduct | null;
  orderStats?: OrderStats;
}): AgentResponse {
  const text = params.message.trim();
  const lower = text.toLowerCase();
  const lastAsk = lastAssistantAsk(params.pendingOrder);
  const previous = mergeOrder(params.pendingOrder, null, params.products);
  const catalog = catalogLine(params.products);
  const namedProduct = findProductInText(lower, params.products);
  const photoAsk = isPhotoRequest(lower);
  const buyAsk = isBuyIntent(lower);
  const withPhotos = (params.products || []).filter((p) => p.image_url);
  const empty = {
    should_create_order: false as const,
    order_id: null,
    needs_human: false,
  };

  if (isStatsQuery(lower)) {
    const s = params.orderStats;
    const shop = s
      ? `Shop ke total orders: ${s.total}. Delivered/complete: ${s.delivered}. Pending: ${s.pending}.`
      : "Order count dashboard → Orders page pe milta hai.";
    const mine = s && s.customerTotal
      ? ` Aap ke WhatsApp se ${s.customerTotal} order save hain.`
      : "";
    return {
      intent: "order_status",
      reply: shop + mine + (params.products?.length ? "\nNaya order ke liye product naam + quantity likhein." : "\nPehle dashboard pe products add hon, tab order ho sakega."),
      parsed_order: previous.products.length ? previous : null,
      confidence: 0.95,
      ...empty,
    };
  }

  if (isBye(lower) && !buyAsk && !photoAsk && !isCatalogAsk(lower)) {
    return {
      intent: "greeting",
      reply: "Allah hafiz! Kuch chahiye ho to message kar dein.",
      parsed_order: previous.products.length ? previous : null,
      confidence: 0.9,
      ...empty,
    };
  }

  if (isCatalogAsk(lower) && !buyAsk && !photoAsk) {
    return {
      intent: "product_inquiry",
      reply: catalogReply(params.businessName, params.products),
      parsed_order: previous.products.length ? previous : null,
      confidence: 0.95,
      ...empty,
    };
  }

  if (photoAsk && !buyAsk) {
    const target = namedProduct || params.referredProduct;
    const targets = /sari|saari|saray|sare|all|tamam|poori|har product|catalog/.test(lower)
      ? withPhotos
      : target?.image_url
        ? [target]
        : withPhotos;
    if (!targets.length) {
      return {
        intent: "product_inquiry",
        reply: params.products?.length
          ? "Products hain lekin unki photos dashboard mein upload nahi. Products page pe image add karein, ya naam + quantity se order karein."
          : emptyCatalogReply(params.businessName),
        parsed_order: previous.products.length ? previous : null,
        confidence: 0.9,
        ...empty,
      };
    }
    return {
      intent: "product_inquiry",
      reply:
        targets.length > 1
          ? `Product photos bhej raha hoon (${targets.length}). Jo lena ho us photo pe reply karke quantity likhein, jaise "2x".`
          : `Photo bhej raha hoon (${targets[0].name}). Agar lena hai to quantity likhein, jaise "2x".`,
      parsed_order: previous.products.length ? previous : null,
      confidence: 0.95,
      ...empty,
      send_images: targets.slice(0, 10).map((p) => ({
        path: p.image_url as string,
        caption: [p.name, `Rs.${p.price}`, p.description].filter(Boolean).join(" — "),
        productName: p.name,
      })),
    };
  }

  if (isGreeting(lower) && !lastAsk && !buyAsk && !photoAsk && !isCatalogAsk(lower)) {
    return {
      intent: "greeting",
      reply: params.products?.length
        ? `Assalam o Alaikum! ${params.businessName} mein ye available hai:\n${catalog}\n\nOrder: naam + quantity. Photos: "photo bhejo".`
        : emptyCatalogReply(params.businessName),
      parsed_order: null,
      confidence: 0.9,
      ...empty,
    };
  }

  if (/\b(ord-\d+)\b/.test(lower) || (/\b(status|track)\b/.test(lower) && /order/.test(lower))) {
    return {
      intent: "order_status",
      reply: "Order status ke liye order number bhej dein, jaise ORD-00001. Admin dashboard se status change hote hi WhatsApp pe update aa jata hai.",
      parsed_order: previous.products.length ? previous : null,
      confidence: 0.8,
      ...empty,
    };
  }

  const collecting = Boolean(lastAsk) || buyAsk || (previous.products.length > 0 && (isAnsweringDetails(lower, text, lastAsk) || looksLikePayment(text) || looksLikeAddress(text)));
  const extracted = collecting
    ? parseOrderFromText(text, params.products, lastAsk, params.referredProduct)
    : null;
  const pending = mergeOrder(params.pendingOrder, extracted, params.products);

  if (namedProduct && /kitne|price|rate|kitna/.test(lower) && !buyAsk && !pending.products.length) {
    return {
      intent: "product_inquiry",
      reply: `${namedProduct.name} available hai — Rs.${namedProduct.price}${namedProduct.description ? `\n${namedProduct.description}` : ""}.\nLena ho to quantity likhein, jaise "2x".`,
      parsed_order: null,
      confidence: 0.9,
      ...empty,
    };
  }

  const confirming = ["yes", "haan", "han", "ok", "theek", "confirm", "done", "finalize", "bilkul"].some(
    (w) => lower.split(/\s+/).includes(w) || lower === w
  );
  if (confirming && pending.products.length && pending.customer_name && pending.address && pending.payment_method) {
    return {
      intent: "confirm_order",
      reply: "Shukriya! Order confirm ho gaya. Hum jald process karenge.",
      parsed_order: { ...pending, notes: null },
      should_create_order: true,
      order_id: null,
      confidence: 0.85,
      needs_human: false,
    };
  }

  if (buyAsk || lastAsk || (extracted && (extracted.products.length || extracted.address || extracted.customer_name || extracted.payment_method))) {
    const priced = matchCatalog(
      pending.products.length
        ? pending
        : namedProduct || params.referredProduct
          ? {
              ...pending,
              products: [
                {
                  name: (namedProduct || params.referredProduct)!.name,
                  quantity: extractQuantity(lower) || 1,
                  variant: null,
                  unit_price: (namedProduct || params.referredProduct)!.price,
                },
              ],
            }
          : pending,
      params.products
    );
    if (!priced.products.length) {
      return {
        intent: "place_order",
        reply: params.products?.length
          ? `Kaunsa product lena hai? Available:\n${catalog}`
          : emptyCatalogReply(params.businessName),
        parsed_order: priced,
        confidence: 0.7,
        ...empty,
      };
    }
    const missing = nextMissingField(priced);
    const lines = formatOrderNote(priced);
    if (missing) {
      return {
        intent: "place_order",
        reply: `${lines}\n\nBaraye meherbani apna ${missing.prompt} bhej dein.`,
        parsed_order: { ...priced, notes: missing.key },
        confidence: 0.85,
        ...empty,
      };
    }
    return {
      intent: "place_order",
      reply: `${lines}\n\nConfirm karne ke liye "yes" likhein.`,
      parsed_order: priced,
      confidence: 0.85,
      ...empty,
    };
  }

  return {
    intent: "general",
    reply: params.products?.length
      ? `Main madad kar sakta hoon.\n• Catalog: "products dikhao"\n• Photos: "photo bhejo"\n• Order: product naam + quantity\n\nAbhi available:\n${catalog}`
      : emptyCatalogReply(params.businessName),
    parsed_order: previous.products.length ? previous : null,
    confidence: 0.6,
    ...empty,
  };
}

function isPhotoRequest(lower: string) {
  return /photo|pic|image|tasveer|tasveerein|picture|photos/.test(lower);
}

function isBuyIntent(lower: string) {
  return (
    /chahye|chahiye|order karo|order karna|lena hai|le lo|book karo|kharid/.test(lower) ||
    /\d+\s*(?:x|×|piece|pcs)\b/.test(lower) ||
    /quantity\s*\d+/.test(lower)
  );
}

function isStatsQuery(lower: string) {
  return (
    (/(kitne|kitna|how many|total)/.test(lower) && /order/.test(lower)) ||
    /complete.*(order|orders)/.test(lower) ||
    /orders?\s+(complete|delivered|hue)/.test(lower)
  );
}

function isGreeting(lower: string) {
  return /(?:^|[\s,.!?])(salam|assalam|assalamualaikum|aoa|hello|hi|hey)(?:$|[\s,.!?])/.test(` ${lower} `);
}

function isBye(lower: string) {
  return /^(bye+|goodbye|allah hafiz|khuda hafiz|ok bye)[\s!.]*$/.test(lower.trim());
}

function isCatalogAsk(lower: string) {
  const t = lower
    .replace(/[?.!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /kya kya|menu\b|catalog|available|rate list|price list|pricelist|stock list/.test(t)
  ) {
    return true;
  }
  const mentionsGoods = /product|products|item|items|saman|stock|catalog|menu/.test(t);
  const asks =
    /kn kn|kaun kaun|kons[aeiy]|konse|konsi|kya|hai|hain|dikhao|dikha|batao|bata|bhejo|bhej|send|list|detail|details|do\b/.test(
      t
    );
  return mentionsGoods && asks;
}

function isAnsweringDetails(lower: string, text: string, lastAsk: "naam" | "address" | "payment" | null) {
  if (lastAsk === "naam") return !isPhotoRequest(lower) && !isStatsQuery(lower);
  if (lastAsk === "address") return looksLikeAddress(text) || lastAsk === "address";
  if (lastAsk === "payment") return looksLikePayment(text);
  return false;
}

function formatOrderNote(order: ParsedOrderData) {
  return [
    "Order note ho gaya:",
    order.customer_name ? `Name: ${order.customer_name}` : "Name: —",
    order.products.length
      ? `Items: ${order.products.map((p) => `${p.quantity}x ${p.name}`).join(", ")}`
      : null,
    order.total != null ? `Total: Rs.${order.total}` : null,
    order.address ? `Address: ${order.address}` : null,
    order.payment_method ? `Payment: ${order.payment_method}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function nextMissingField(order: ParsedOrderData): { key: "naam" | "address" | "payment"; prompt: string } | null {
  if (!order.customer_name) return { key: "naam", prompt: "poora naam (sirf naam, address nahi)" };
  if (!order.address) return { key: "address", prompt: "delivery address" };
  if (!order.payment_method) return { key: "payment", prompt: "payment method (COD / Easypaisa / JazzCash)" };
  return null;
}

function lastAssistantAsk(pending?: Record<string, unknown> | null): "naam" | "address" | "payment" | null {
  const notes = String(pending?.notes || "");
  if (notes === "naam" || notes === "address" || notes === "payment") return notes;
  return null;
}

function isPointingAtProduct(lower: string) {
  return /\b(yeh?|this|that|isi|usi|wala|wali|wale|same)\b/.test(lower) || /\d+\s*x\b/.test(lower);
}

export function findProductInText(lower: string, products?: CatalogProduct[]) {
  if (!products?.length) return null;
  const sorted = [...products].sort((a, b) => b.name.length - a.name.length);
  return (
    sorted.find((p) => lower.includes(p.name.toLowerCase())) ||
    sorted.find((p) =>
      p.name
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .some((w) => lower.includes(w))
    ) ||
    null
  );
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
  che: 6,
  six: 6,
  saat: 7,
  seven: 7,
  aath: 8,
  eight: 8,
  nau: 9,
  nine: 9,
  das: 10,
  ten: 10,
};

function extractQuantity(lower: string): number | null {
  const labeled = lower.match(/(?:quantity|qty|kitni|kitna)\s*[:=]?\s*(\d{1,4})/);
  if (labeled) return parseInt(labeled[1], 10);
  const x = lower.match(/(\d{1,4})\s*(?:x|×|\*|pieces?|pcs|qty)/);
  if (x) return parseInt(x[1], 10);
  const want = lower.match(/(\d{1,4})\s*(?:chahye|chahiye|chahiye)/);
  if (want) return parseInt(want[1], 10);
  for (const [word, n] of Object.entries(URDU_QTY)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return n;
  }
  return null;
}

function looksLikeAddress(text: string) {
  return /town|block|phase|sector|street|gali|lahore|karachi|islamabad|rawalpindi|faisalabad|multan|house|mohalla|colony|road|chowk|address|tehsil|district/.test(
    text.toLowerCase()
  );
}

function looksLikePayment(text: string) {
  return /\b(cod|cash|easypaisa|jazzcash|bank)\b/.test(text.toLowerCase());
}

function extractPayment(lower: string): ParsedOrderData["payment_method"] {
  if (/\bcod\b/.test(lower) || /cash on delivery/.test(lower)) return "cod";
  if (/easypaisa/.test(lower)) return "easypaisa";
  if (/jazzcash/.test(lower)) return "jazzcash";
  if (/\bcash\b/.test(lower)) return "cash";
  return null;
}

function extractName(text: string, awaitingName: boolean): string | null {
  const labeled = text.match(
    /(?:mera naam|my name(?: is)?|name\s*[:=]|main)\s+([A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF\s.'-]{1,40})/i
  );
  if (labeled) {
    const name = cleanPersonName(labeled[1]);
    if (name) return name;
  }
  if (!awaitingName) return null;
  if (looksLikeAddress(text) || looksLikePayment(text)) return null;
  if (extractQuantity(text.toLowerCase())) return null;
  const cleaned = cleanPersonName(
    text.replace(/^(mera naam|my name is|i am|main)\s+/i, "").replace(/\b(hai|hoon|hun)\b/gi, "")
  );
  if (!cleaned) return null;
  const words = cleaned.split(/\s+/);
  if (words.length > 5 || cleaned.length > 40) return null;
  return cleaned;
}

function cleanPersonName(raw: string) {
  const stop = new Set([
    "cotton",
    "suit",
    "quantity",
    "chahye",
    "chahiye",
    "address",
    "block",
    "town",
    "lahore",
    "karachi",
    "order",
    "product",
  ]);
  const words = raw
    .trim()
    .replace(/[^A-Za-z\u0600-\u06FF\s.'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !stop.has(w.toLowerCase()));
  if (!words.length) return null;
  return words.join(" ");
}

function extractAddress(text: string, awaitingAddress: boolean): string | null {
  if (!looksLikeAddress(text) && !awaitingAddress) return null;
  if (looksLikePayment(text) && !looksLikeAddress(text)) return null;
  if (awaitingAddress && extractName(text, false) && text.split(/\s+/).length <= 4 && !looksLikeAddress(text)) {
    return null;
  }
  const cleaned = text
    .replace(/yeh? hai mera address/gi, "")
    .replace(/mera address (yeh? hai|:)?/gi, "")
    .replace(/address\s*[:=]/gi, "")
    .replace(/\b(hai|please|plz)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

function mergeOrder(
  pending: Record<string, unknown> | null | undefined,
  extracted: ParsedOrderData | null,
  products?: CatalogProduct[]
): ParsedOrderData {
  const base: ParsedOrderData = {
    customer_name: (pending?.customer_name as string) || null,
    phone: (pending?.phone as string) || null,
    address: (pending?.address as string) || null,
    products: Array.isArray(pending?.products) ? (pending?.products as ParsedOrderData["products"]) : [],
    subtotal: (pending?.subtotal as number) || null,
    delivery_fee: (pending?.delivery_fee as number) || null,
    discount: (pending?.discount as number) || null,
    total: (pending?.total as number) || null,
    payment_method: (pending?.payment_method as ParsedOrderData["payment_method"]) || null,
    payment_status: (pending?.payment_status as ParsedOrderData["payment_status"]) || null,
    notes: (pending?.notes as string) || null,
  };
  if (!extracted) return matchCatalog(base, products);
  return matchCatalog(
    {
      customer_name: extracted.customer_name || base.customer_name,
      phone: extracted.phone || base.phone,
      address: extracted.address || base.address,
      products: extracted.products.length ? extracted.products : base.products,
      subtotal: extracted.subtotal ?? base.subtotal,
      delivery_fee: extracted.delivery_fee ?? base.delivery_fee,
      discount: extracted.discount ?? base.discount,
      total: extracted.total ?? base.total,
      payment_method: extracted.payment_method || base.payment_method,
      payment_status: extracted.payment_status || base.payment_status,
      notes: extracted.notes || base.notes,
    },
    products
  );
}

function matchCatalog(order: ParsedOrderData, products?: CatalogProduct[]): ParsedOrderData {
  const mapped = order.products.map((item) => {
    const hit = products?.find(
      (p) =>
        item.name.toLowerCase().includes(p.name.toLowerCase()) ||
        p.name.toLowerCase().includes(item.name.toLowerCase())
    );
    if (!hit) return item;
    return { ...item, name: hit.name, unit_price: hit.price };
  });
  const subtotal = mapped.reduce((s, p) => s + (p.unit_price ?? 0) * p.quantity, 0);
  const total = subtotal + (order.delivery_fee ?? 0) - (order.discount ?? 0);
  return {
    ...order,
    products: mapped,
    subtotal: mapped.length ? subtotal : order.subtotal,
    total: mapped.length ? total : order.total,
  };
}

export function parseOrderFromText(
  text: string,
  products?: CatalogProduct[],
  awaiting: "naam" | "address" | "payment" | null = null,
  referredProduct?: CatalogProduct | null
): ParsedOrderData | null {
  const phoneMatch = text.match(/(\+?92|0)?3\d{9}/);
  const lower = text.toLowerCase();
  const payment = extractPayment(lower);
  const qty = extractQuantity(lower);
  const collectingDetails = awaiting === "naam" || awaiting === "address" || awaiting === "payment";
  const useReferred = Boolean(referredProduct) && (!collectingDetails || qty != null || isPointingAtProduct(lower));
  const chosen = findProductInText(lower, products) || (useReferred ? referredProduct : null);
  const address = extractAddress(text, awaiting === "address");
  const name = extractName(text, awaiting === "naam");

  const productsList =
    chosen && (!collectingDetails || qty != null || isPointingAtProduct(lower))
      ? [
          {
            name: chosen.name,
            quantity: qty || 1,
            variant: null,
            unit_price: chosen.price,
          },
        ]
      : [];

  if (!phoneMatch && !productsList.length && !address && !payment && !name) return null;
  return {
    customer_name: name,
    phone: phoneMatch?.[0] ?? null,
    address,
    products: productsList,
    subtotal: null,
    delivery_fee: null,
    discount: null,
    total: null,
    payment_method: payment,
    payment_status: payment === "cod" ? ("unpaid" as PaymentStatus) : null,
    notes: null,
  };
}
