import OpenAI from "openai";
import type { AgentIntent, AgentResponse, ParsedOrderData, PaymentStatus } from "@/types/database";

type CatalogProduct = {
  name: string;
  price: number;
  description?: string;
  image_url?: string | null;
};

type OrderStats = {
  total: number;
  delivered: number;
  pending: number;
  customerTotal: number;
};

type AgentParams = {
  message: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  businessName: string;
  agentName: string;
  products?: CatalogProduct[];
  pendingOrder?: Record<string, unknown> | null;
  customerName?: string | null;
  instructions?: string | null;
  referredProduct?: CatalogProduct | null;
  groqApiKey?: string | null;
  orderStats?: OrderStats;
};

function looksLikeRealKey(key?: string) {
  if (!key) return false;
  if (/your-|placeholder|example|changeme/i.test(key)) return false;
  return /^(sk-|gsk_|AIza)/.test(key) || key.length > 24;
}

function getAIClient(shopGroqKey?: string | null): { client: OpenAI; model: string } | null {
  const groq = (shopGroqKey || process.env.GROQ_API_KEY || "").trim();
  if (looksLikeRealKey(groq)) {
    return {
      client: new OpenAI({ apiKey: groq, baseURL: "https://api.groq.com/openai/v1" }),
      model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
    };
  }
  const gemini = process.env.GEMINI_API_KEY;
  if (looksLikeRealKey(gemini)) {
    return {
      client: new OpenAI({
        apiKey: gemini,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      }),
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    };
  }
  const key = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (looksLikeRealKey(key)) {
    return {
      client: new OpenAI({
        apiKey: key,
        baseURL: process.env.AI_BASE_URL || undefined,
      }),
      model: process.env.AI_MODEL || "gpt-4o-mini",
    };
  }
  return null;
}

export async function processAgentMessage(params: AgentParams): Promise<AgentResponse> {
  const ai = getAIClient(params.groqApiKey);
  let result: AgentResponse;
  if (ai) {
    try {
      const llm = await llmAgent(ai.client, ai.model, params);
      result = llm.reply.trim() ? llm : localAgent(params);
    } catch (error) {
      console.error("LLM agent failed, falling back to local rules:", error);
      result = localAgent(params);
    }
  } else {
    result = localAgent(params);
  }
  result = attachProductMedia(result, params);
  if (needsStaffAttention(params.message) || result.intent === "human_handoff") {
    result = {
      ...result,
      needs_human: true,
      intent: "human_handoff",
    };
  }
  return result;
}

function formatProductCard(p: CatalogProduct) {
  return [
    `📦 *${p.name}*`,
    `💰 Price: Rs.${p.price}`,
    p.description ? `📝 ${p.description}` : null,
    p.image_url ? "📷 Photo neeche bhej raha hoon" : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function catalogCardsText(products: CatalogProduct[]) {
  return products.slice(0, 8).map(formatProductCard).join("\n\n");
}

function attachProductMedia(result: AgentResponse, params: AgentParams): AgentResponse {
  const products = params.products || [];
  if (!products.length) return result;
  const lower = params.message.toLowerCase();
  const named = findProductInText(lower, products);
  const show =
    result.intent === "product_inquiry" ||
    result.intent === "greeting" ||
    isCatalogAsk(lower) ||
    isPhotoRequest(lower) ||
    Boolean(result.send_images?.length);
  if (!show) return result;

  const pick = named ? [named] : products.slice(0, 8);
  const images = pick
    .filter((p) => p.image_url)
    .map((p) => ({
      path: p.image_url as string,
      caption: formatProductCard(p),
      productName: p.name,
    }));
  const cards = catalogCardsText(pick);
  const alreadyRich = /\*/.test(result.reply) && /Rs\./.test(result.reply);
  return {
    ...result,
    reply: alreadyRich ? result.reply : `${result.reply.trim()}\n\n${cards}`,
    send_images: images.length ? images : result.send_images,
  };
}

function needsStaffAttention(message: string) {
  const t = message.toLowerCase();
  return (
    /insan se|human|operator|manager se baat|complaint|complain|fraud|scam|cheat|dhamki|police|court|refund nahi|bewaqoof|gali|mc\b|bc\b|bsdk|porn|sex|nude/.test(
      t
    ) || t.length > 400
  );
}

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
  return `${businessName} ke available products:\n${catalog}\n\nJo lena ho naam + quantity likhein (jaise "2x Cotton Suit"). Photos sath bhej raha hoon.`;
}

function imagesForNames(products: CatalogProduct[] | undefined, names: string[]) {
  const catalog = products || [];
  const wanted = names.length
    ? catalog.filter((p) =>
        names.some(
          (n) =>
            p.name.toLowerCase() === n.toLowerCase() ||
            p.name.toLowerCase().includes(n.toLowerCase()) ||
            n.toLowerCase().includes(p.name.toLowerCase())
        )
      )
    : catalog;
  return wanted
    .filter((p) => p.image_url)
    .slice(0, 10)
    .map((p) => ({
      path: p.image_url as string,
      caption: [p.name, `Rs.${p.price}`, p.description].filter(Boolean).join(" — "),
      productName: p.name,
    }));
}

async function llmAgent(client: OpenAI, model: string, params: AgentParams): Promise<AgentResponse> {
  const catalog = params.products || [];
  const catalogJson = catalog.map((p) => ({
    name: p.name,
    price: p.price,
    description: p.description || "",
    has_photo: Boolean(p.image_url),
  }));
  const stats = params.orderStats;
  const system = `You are ${params.agentName}, WhatsApp sales assistant for "${params.businessName}" (Pakistan shop).
Talk like a real helpful shop person: natural Roman Urdu + simple English. Friendly, free conversation, satisfy the customer. Not a robot menu.

RULES:
- ONLY use products in DASHBOARD_PRODUCTS. Never invent items or prices.
- If DASHBOARD_PRODUCTS is empty, honestly say catalog empty; malik must add products in dashboard. Do not take fake orders.
- Use SHOP_NOTES for delivery charges, COD, timings, policies.
- Use PENDING_ORDER to continue the same order (don't restart unless customer wants new order).
- When showing products (greeting, list, details, "kya hai"), ALWAYS describe each item clearly: name, price Rs., description. Photos are sent automatically — set send_photos=true and photo_product_names to those product names. Do not tell the user to type "photo bhejo".
- If customer is abusive, threatening, asking for a human, or the request is outside selling (scam/illegal), set intent to human_handoff, stay polite, say a team member will check the dashboard, and do not argue.
- Collect a COMPLETE order ticket for the shop dashboard: items+qty+price, customer full name, WhatsApp/phone, full delivery address, payment method.
- Collect step by step: items+qty, then naam, then address, then payment (COD/Easypaisa/JazzCash), then ask to confirm with "yes".
- Put every collected field into parsed_order every turn (carry forward PENDING_ORDER).
- should_create_order=true ONLY when items, naam, address, payment are all present AND customer confirmed.
- Keep WhatsApp replies useful, not empty. 4-12 lines is OK when listing products.

Return ONLY JSON:
{"reply":"string","intent":"greeting|product_inquiry|place_order|confirm_order|order_status|general|human_handoff","should_create_order":false,"send_photos":true,"photo_product_names":[],"needs_human":false,"parsed_order":{"customer_name":null,"phone":null,"address":null,"payment_method":null,"products":[{"name":"","quantity":1}],"notes":null}}`;

  const user = `DASHBOARD_PRODUCTS: ${JSON.stringify(catalogJson)}
SHOP_NOTES: ${params.instructions || "(none)"}
CUSTOMER_WHATSAPP_NAME: ${params.customerName || "(unknown)"}
PENDING_ORDER: ${JSON.stringify(params.pendingOrder || null)}
REFERRED_PRODUCT: ${params.referredProduct ? JSON.stringify(params.referredProduct) : "null"}
ORDER_STATS: ${stats ? JSON.stringify(stats) : "null"}
LATEST_CUSTOMER_MESSAGE: ${params.message}`;

  const history = (params.conversationHistory || []).slice(-8).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const completion = await client.chat.completions.create(
    {
      model,
      temperature: 0.4,
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        ...history,
        { role: "user", content: user },
      ],
    },
    { timeout: 9000 }
  );

  const raw = completion.choices[0]?.message?.content || "{}";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    parsed = start >= 0 && end > start ? (JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>) : {};
  }

  const reply = String(parsed.reply || "").trim();
  if (!reply) throw new Error("Empty LLM reply");

  const rawOrder = (parsed.parsed_order || null) as Record<string, unknown> | null;
  const extracted: ParsedOrderData | null = rawOrder
    ? {
        customer_name: (rawOrder.customer_name as string) || null,
        phone: (rawOrder.phone as string) || null,
        address: (rawOrder.address as string) || null,
        products: Array.isArray(rawOrder.products)
          ? (rawOrder.products as Array<{ name?: string; quantity?: number }>).map((p) => ({
              name: String(p.name || ""),
              quantity: Number(p.quantity) || 1,
              variant: null,
              unit_price: null,
            })).filter((p) => p.name)
          : [],
        subtotal: null,
        delivery_fee: null,
        discount: null,
        total: null,
        payment_method: (rawOrder.payment_method as ParsedOrderData["payment_method"]) || null,
        payment_status: null,
        notes: (rawOrder.notes as string) || null,
      }
    : null;

  const pending = mergeOrder(params.pendingOrder, extracted, params.products);
  const intent = (["greeting", "place_order", "confirm_order", "cancel_order", "order_status", "product_inquiry", "payment_inquiry", "delivery_inquiry", "general", "human_handoff"].includes(String(parsed.intent))
    ? parsed.intent
    : "general") as AgentIntent;

  const wantPhotos =
    Boolean(parsed.send_photos) ||
    isPhotoRequest(params.message.toLowerCase()) ||
    intent === "product_inquiry" ||
    intent === "greeting";
  const photoNames = Array.isArray(parsed.photo_product_names)
    ? (parsed.photo_product_names as unknown[]).map((n) => String(n))
    : [];
  const send_images = wantPhotos ? imagesForNames(params.products, photoNames) : undefined;

  const confirmed = Boolean(parsed.should_create_order);
  const complete =
    pending.products.length > 0 &&
    Boolean(pending.customer_name) &&
    Boolean(pending.address) &&
    Boolean(pending.payment_method);

  return {
    intent,
    reply,
    parsed_order: pending.products.length || pending.customer_name || pending.address ? pending : extracted,
    should_create_order: confirmed && complete,
    order_id: null,
    confidence: 0.85,
    needs_human: intent === "human_handoff" || Boolean(parsed.needs_human),
    send_images: send_images?.length ? send_images : undefined,
  };
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
        ? `Assalam o Alaikum! ${params.businessName} mein ye available hai:\n${catalog}\n\nOrder ke liye naam + quantity likhein. Photos sath attached hain.`
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
