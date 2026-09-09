import OpenAI from "openai";
import type { AgentIntent, AgentResponse, ParsedOrderData, PaymentStatus } from "@/types/database";
import {
  catalogSummary,
  formatProductCard,
  needsSeeMore,
  parseSizeOptions,
  productsInCategory,
  stripPhotoTalk,
  uniqueCategories,
  type ShopProduct,
} from "@/lib/catalog";

type CatalogProduct = ShopProduct;

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
  easypaisaNumber?: string | null;
  jazzcashNumber?: string | null;
  selectedCategory?: string | null;
  seeMoreProductId?: string | null;
};

function looksLikeRealKey(key?: string) {
  if (!key) return false;
  if (/your-|placeholder|example|changeme/i.test(key)) return false;
  return /^(sk-|gsk_|AIza)/.test(key) || key.length > 24;
}

/** Groq retired llama-3.1-8b-instant (Aug 2026). Prefer current production models. */
const GROQ_MODELS = [
  process.env.GROQ_MODEL,
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
].filter((m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i);

function getAIClient(shopGroqKey?: string | null): { client: OpenAI; model: string; models: string[] } | null {
  const groq = (shopGroqKey || process.env.GROQ_API_KEY || "").trim();
  if (looksLikeRealKey(groq)) {
    return {
      client: new OpenAI({ apiKey: groq, baseURL: "https://api.groq.com/openai/v1" }),
      model: GROQ_MODELS[0],
      models: GROQ_MODELS,
    };
  }
  const gemini = process.env.GEMINI_API_KEY;
  if (looksLikeRealKey(gemini)) {
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    return {
      client: new OpenAI({
        apiKey: gemini,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      }),
      model,
      models: [model],
    };
  }
  const key = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (looksLikeRealKey(key)) {
    const model = process.env.AI_MODEL || "gpt-4o-mini";
    return {
      client: new OpenAI({
        apiKey: key,
        baseURL: process.env.AI_BASE_URL || undefined,
      }),
      model,
      models: [model],
    };
  }
  return null;
}

export async function processAgentMessage(params: AgentParams): Promise<AgentResponse> {
  if (params.seeMoreProductId) {
    const hit =
      (params.products || []).find((p) => p.id === params.seeMoreProductId) ||
      findProductInText(params.seeMoreProductId.toLowerCase(), params.products);
    if (hit) {
      return withShopMenus(
        {
          intent: "product_inquiry",
          reply: formatProductCard(hit, { full: true }),
          parsed_order: null,
          should_create_order: false,
          order_id: null,
          confidence: 1,
          needs_human: false,
          skip_media: true,
        },
        params
      );
    }
  }

  // Voice failed → ask to type (do not dump generic catalog help)
  if (isVoiceFailedMarker(params.message)) {
    const lang = inferCustomerLanguage(
      lastUserText(params.conversationHistory) || "hello",
      params.conversationHistory
    );
    return {
      intent: "general",
      reply:
        lang === "English"
          ? "I couldn't hear your voice note clearly. Please type your message (e.g. Do you have shoes?)."
          : "Voice note clear nahi suni. Baraye meherbani type karke likhein (jaise: shoes hain?).",
      parsed_order: params.pendingOrder ? mergeOrder(params.pendingOrder, null, params.products) : null,
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }

  // "2" as QUANTITY (sirf 1 chahye) must NOT become catalog product #1
  const qtyReply = isQuantityReply(params.message, params.conversationHistory, params.pendingOrder);
  const offered =
    params.referredProduct ||
    lastOfferedProduct(params.conversationHistory, params.products) ||
    (pendingProductName(params.pendingOrder)
      ? findProductInText(String(pendingProductName(params.pendingOrder)).toLowerCase(), params.products)
      : null);

  if (qtyReply != null && offered) {
    const en = inferCustomerLanguage(params.message, params.conversationHistory) === "English";
    const sizes = parseSizeOptions(offered.sizes);
    const pending = mergeOrder(
      params.pendingOrder,
      {
        customer_name: null,
        phone: null,
        address: null,
        products: [
          {
            name: offered.name,
            quantity: qtyReply,
            variant: null,
            unit_price: offered.price,
          },
        ],
        subtotal: null,
        delivery_fee: null,
        discount: null,
        total: null,
        payment_method: null,
        payment_status: null,
        notes: sizes.length ? "size" : "naam",
      },
      params.products
    );
    const missing = nextMissingField(pending, params.products);
    return {
      intent: "place_order",
      reply: en
        ? `Perfect — ${qtyReply}x ${offered.name} (Rs.${offered.price} each).${
            missing ? ` Please share your ${missing.prompt}.` : ' Reply "yes" to confirm the order.'
          }`
        : `Theek hai — ${qtyReply}x ${offered.name} (Rs.${offered.price}).${
            missing ? ` Ab apna ${missing.prompt} bhej dein.` : ' Confirm ke liye "yes" likhein.'
          }`,
      parsed_order: missing ? { ...pending, notes: missing.key } : pending,
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }

  // Catalog number pick ONLY when not answering quantity for an already-chosen product
  const catalogNumberPick = resolveNumberedProductPick(
    params.message,
    params.conversationHistory,
    params.products
  );
  const answeringQtyForOffer =
    Boolean(offered) &&
    (/^\d{1,2}\s*[.!]?$/.test(params.message.trim()) ||
      /sirf|only|chahye|chahiye|quantity|qty/.test(params.message.toLowerCase()));
  const useCatalogPick = Boolean(catalogNumberPick) && !answeringQtyForOffer;

  let working: AgentParams = params;
  if (useCatalogPick && catalogNumberPick) {
    working = {
      ...params,
      message: `${params.message} (selected catalog #${catalogNumberPick.index}: ${catalogNumberPick.product.name})`,
      referredProduct: catalogNumberPick.product,
    };
  } else if (offered && !params.referredProduct) {
    working = { ...params, referredProduct: offered };
  }

  const numberPickActive = Boolean(useCatalogPick && catalogNumberPick);

  const lowerMsg = working.message.toLowerCase();
  const namedUpfront = findProductInText(lowerMsg, working.products) || working.referredProduct || offered || null;

  // Single-product details/photo → answer ONLY that product (no full catalog)
  if (namedUpfront && isDetailOrPhotoAsk(lowerMsg) && !isBuyIntent(lowerMsg)) {
    const en = inferCustomerLanguage(working.message, working.conversationHistory) === "English";
    const sizes = parseSizeOptions(namedUpfront.sizes);
    return {
      intent: "product_inquiry",
      reply: [
        formatProductCard(namedUpfront, { full: true }),
        sizes.length
          ? en
            ? `Available sizes: ${sizes.join(", ")}. Want to order? Tell me size + quantity.`
            : `Available sizes: ${sizes.join(", ")}. Order ke liye size + quantity bataein.`
          : en
            ? "Want to order this? Tell me the quantity."
            : "Isko lena hai to quantity bataein.",
      ].join("\n\n"),
      parsed_order: working.pendingOrder ? mergeOrder(working.pendingOrder, null, working.products) : null,
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      send_images: namedUpfront.image_url
        ? [
            {
              path: namedUpfront.image_url,
              caption: formatProductCard(namedUpfront),
              productName: namedUpfront.name,
              productId: namedUpfront.id,
              seeMore: needsSeeMore(namedUpfront.description),
            },
          ]
        : undefined,
      skip_media: true,
    };
  }

  // "ye product chahiye" / buy named item / catalog number pick → lock order, don't restart catalog
  if (
    namedUpfront &&
    (numberPickActive ||
      isBuyIntent(lowerMsg) ||
      /yeh? (wala|wali|wale)|this one|isi|usi|lena|le lo|order/.test(lowerMsg))
  ) {
    const en = inferCustomerLanguage(working.message, working.conversationHistory) === "English";
    const qty = extractQuantity(lowerMsg) || 1;
    const sizes = parseSizeOptions(namedUpfront.sizes);
    const pending = mergeOrder(
      working.pendingOrder,
      {
        customer_name: null,
        phone: null,
        address: null,
        products: [
          {
            name: namedUpfront.name,
            quantity: qty,
            variant: null,
            unit_price: namedUpfront.price,
          },
        ],
        subtotal: null,
        delivery_fee: null,
        discount: null,
        total: null,
        payment_method: null,
        payment_status: null,
        notes: sizes.length ? "size" : null,
      },
      working.products
    );
    const missing = nextMissingField(pending, working.products);
    return {
      intent: "place_order",
      reply: en
        ? `Got it — ${qty}x ${namedUpfront.name} (Rs.${namedUpfront.price}).${
            missing ? ` Please share your ${missing.prompt}.` : ' Reply "yes" to confirm.'
          }`
        : `Theek hai — ${qty}x ${namedUpfront.name} (Rs.${namedUpfront.price}).${
            missing ? ` Baraye meherbani apna ${missing.prompt} bhej dein.` : ' Confirm ke liye "yes" likhein.'
          }`,
      parsed_order: missing ? { ...pending, notes: missing.key } : pending,
      should_create_order: false,
      order_id: null,
      confidence: 0.95,
      needs_human: false,
      skip_media: true,
    };
  }

  // Category browse only when asking category list, not when a specific product is named
  const categoryHint = detectCategoryFromMessage(working.message, working.products);
  if (categoryHint && !working.selectedCategory && !namedUpfront && !isBuyIntent(lowerMsg)) {
    working = { ...working, selectedCategory: categoryHint };
  }

  const ai = getAIClient(working.groqApiKey);
  let result: AgentResponse;
  if (ai) {
    try {
      const llm = await llmAgent(ai.client, ai.models, working);
      if (!llm.reply.trim()) throw new Error("Empty Groq reply");
      result = llm;
    } catch (error) {
      console.error("LLM agent failed, falling back to local rules:", error);
      result = localAgent(working);
    }
  } else {
    result = localAgent(working);
    const missingKey = !looksLikeRealKey(working.groqApiKey || process.env.GROQ_API_KEY);
    if (missingKey) {
      const en = inferCustomerLanguage(working.message, working.conversationHistory) === "English";
      result = {
        ...result,
        reply: en
          ? `${result.reply}\n\n(Shop owner: add Groq API key in WhatsApp settings for full AI chat.)`
          : `${result.reply}\n\n(Malik: WhatsApp settings mein Groq API key add karein taake full AI chat chale.)`,
      };
    }
  }

  result = {
    ...result,
    reply: stripPhotoTalk(result.reply),
  };
  result = attachProductMedia(result, working);
  result = withShopMenus(result, working);

  const cancelAsk = isCancelRequest(working.message);
  if (cancelAsk || needsStaffAttention(working.message) || result.intent === "human_handoff" || result.intent === "cancel_order") {
    result = {
      ...result,
      needs_human: true,
      intent: cancelAsk ? "human_handoff" : result.intent === "cancel_order" ? "human_handoff" : "human_handoff",
      reply: cancelAsk
        ? appendCancelAck(result.reply, inferCustomerLanguage(working.message, working.conversationHistory))
        : result.reply,
    };
  }
  return result;
}

function appendCancelAck(reply: string, lang: string) {
  const note =
    lang === "English"
      ? "I've flagged your cancel request for the shop team — they'll check the dashboard now."
      : "Aap ki cancel request shop team ko flag kar di — dashboard pe abhi attention aa gayi hai.";
  if (/flag|attention|dashboard|team/i.test(reply)) return reply;
  return `${reply.trim()}\n\n${note}`;
}

function isVoiceFailedMarker(message: string) {
  return /^\[voice message\]$/i.test(message.trim()) || /^\[voice failed/i.test(message.trim());
}

function lastUserText(history?: Array<{ role: string; content: string }>) {
  return [...(history || [])].reverse().find((m) => m.role === "user")?.content || "";
}

function detectCategoryFromMessage(message: string, products?: CatalogProduct[]) {
  const cats = uniqueCategories(products || []);
  const lower = message.toLowerCase();
  for (const c of cats) {
    if (lower.includes(c.toLowerCase())) return c;
  }
  if (/\bshoes?\b|joota|joote|sneakers?|footwear/.test(lower)) {
    const hit = cats.find((c) => /shoe|footwear|sneaker|joota/i.test(c));
    if (hit) return hit;
    // virtual category if products mention shoes in name/description
    const soft = (products || []).filter((p) =>
      /shoe|sneaker|joota|footwear/i.test(`${p.name} ${p.category || ""} ${p.description || ""}`)
    );
    if (soft.length) return "Shoes";
  }
  return null;
}

function resolveNumberedProductPick(
  message: string,
  history: Array<{ role: string; content: string }> | undefined,
  products?: CatalogProduct[]
): { index: number; product: CatalogProduct } | null {
  if (!products?.length) return null;
  const m = message.trim().match(/^(?:no\.?|number|#|option|item)?\s*(\d{1,2})\b/i);
  const n = m ? parseInt(m[1], 10) : null;
  if (!n || n < 1) return null;

  // Prefer last assistant numbered list
  const lastAssistant = [...(history || [])]
    .reverse()
    .find((h) => h.role === "assistant" && /\d+\)/.test(h.content));
  if (lastAssistant) {
    const lines = lastAssistant.content.split(/\n/).map((l) => l.trim());
    for (const line of lines) {
      const hit = line.match(/^(\d+)\)\s*([^*—\n-]+)/);
      if (hit && parseInt(hit[1], 10) === n) {
        const name = hit[2].replace(/—.*$/, "").replace(/\s+Rs\..*$/i, "").trim();
        const product =
          products.find((p) => p.name.toLowerCase() === name.toLowerCase()) ||
          findProductInText(name.toLowerCase(), products);
        if (product) return { index: n, product };
      }
    }
  }
  if (n <= products.length) return { index: n, product: products[n - 1] };
  return null;
}

function isCancelRequest(message: string) {
  const t = message.toLowerCase();
  return /cancel|order cancel|cancel karo|cancel krdo|cancel kar do|cancel kar den|mera order cancel|don't want|nahi chahiye order/.test(
    t
  );
}

function withShopMenus(result: AgentResponse, params: AgentParams): AgentResponse {
  if (result.skip_media) return result;
  const lower = params.message.toLowerCase();
  // Mid-order / single-product detail / buy → no category dump menus
  if (
    result.intent === "place_order" ||
    result.intent === "confirm_order" ||
    isBuyIntent(lower) ||
    isDetailOrPhotoAsk(lower) ||
    Boolean(params.referredProduct && !isCatalogAsk(lower))
  ) {
    return { ...result, quick_replies: undefined, list_menu: undefined };
  }

  const products = params.products || [];
  const cats = uniqueCategories(products);
  const quick = result.quick_replies?.length
    ? result.quick_replies
    : [
        { id: "menu:catalog", title: "Catalog" },
        { id: "menu:order", title: "Order" },
        { id: "menu:pay", title: "Payment" },
      ];
  const list =
    result.list_menu ||
    (cats.length
      ? {
          body: "Category choose karein:",
          button: "Categories",
          rows: [
            { id: "cat:all", title: "All products", description: "Poori list" },
            ...cats.slice(0, 9).map((c) => ({
              id: `cat:${c}`,
              title: c.slice(0, 24),
              description: `${productsInCategory(products, c).length} items`,
            })),
          ],
        }
      : undefined);
  const showMenus =
    result.intent === "greeting" ||
    (isCatalogAsk(lower) && !findProductInText(lower, products)) ||
    (Boolean(params.selectedCategory) && !findProductInText(lower, products) && !isBuyIntent(lower));
  return {
    ...result,
    quick_replies: showMenus ? quick : undefined,
    list_menu: showMenus ? list : undefined,
  };
}

function isDetailOrPhotoAsk(lower: string) {
  return (
    isPhotoRequest(lower) ||
    /detail|details|info|information|batao|bata|dikhao|dikha|tell me about|more about|description/.test(lower)
  );
}

function attachProductMedia(result: AgentResponse, params: AgentParams): AgentResponse {
  if (result.skip_media) return result;
  const products = params.products || [];
  if (!products.length) return result;
  const lower = params.message.toLowerCase();
  const named = findProductInText(lower, products) || params.referredProduct || null;

  // If LLM already chose specific images, keep ONLY those (never expand to full catalog)
  if (result.send_images?.length) {
    const onlyNamed =
      named && result.send_images.length > 1
        ? result.send_images.filter(
            (img) =>
              img.productName?.toLowerCase() === named.name.toLowerCase() ||
              img.caption.toLowerCase().includes(named.name.toLowerCase())
          )
        : result.send_images;
    const scoped = onlyNamed.length ? onlyNamed : named && named.image_url
      ? [
          {
            path: named.image_url,
            caption: formatProductCard(named),
            productName: named.name,
            productId: named.id,
            seeMore: needsSeeMore(named.description),
          },
        ]
      : result.send_images.slice(0, 1);
    return { ...result, reply: stripPhotoTalk(result.reply), send_images: scoped };
  }

  // Buying / placing order: at most one photo of the chosen item, never catalog dump
  if (result.intent === "place_order" || result.intent === "confirm_order" || isBuyIntent(lower)) {
    const target =
      named ||
      (result.parsed_order?.products?.[0]
        ? findProductInText(result.parsed_order.products[0].name.toLowerCase(), products)
        : null);
    if (target?.image_url && (isPhotoRequest(lower) || isDetailOrPhotoAsk(lower))) {
      return {
        ...result,
        reply: stripPhotoTalk(result.reply),
        send_images: [
          {
            path: target.image_url,
            caption: formatProductCard(target),
            productName: target.name,
            productId: target.id,
            seeMore: needsSeeMore(target.description),
          },
        ],
      };
    }
    return { ...result, reply: stripPhotoTalk(result.reply), send_images: undefined };
  }

  // Explicit details/photo for ONE product
  if (named && isDetailOrPhotoAsk(lower)) {
    return {
      ...result,
      reply: stripPhotoTalk(result.reply) || formatProductCard(named, { full: true }),
      send_images: named.image_url
        ? [
            {
              path: named.image_url,
              caption: formatProductCard(named),
              productName: named.name,
              productId: named.id,
              seeMore: needsSeeMore(named.description),
            },
          ]
        : undefined,
    };
  }

  // Full catalog / category browse only when they asked for list (not a single item)
  const catalogBrowse = isCatalogAsk(lower) && !named;
  const categoryBrowse =
    Boolean(params.selectedCategory) && !named && !isBuyIntent(lower) && !isDetailOrPhotoAsk(lower);
  if (!catalogBrowse && !categoryBrowse) {
    return { ...result, reply: stripPhotoTalk(result.reply) };
  }

  const pick = categoryBrowse
    ? productsInCategory(products, params.selectedCategory!).slice(0, 8)
    : products.slice(0, 8);
  const images = pick
    .filter((p) => p.image_url)
    .map((p) => ({
      path: p.image_url as string,
      caption: formatProductCard(p),
      productName: p.name,
      productId: p.id,
      seeMore: needsSeeMore(p.description),
    }));
  return {
    ...result,
    reply: stripPhotoTalk(result.reply),
    send_images: images.length ? images : undefined,
  };
}

function needsStaffAttention(message: string) {
  const t = message.toLowerCase();
  return (
    isCancelRequest(t) ||
    /insan se|human|operator|manager se baat|complaint|complain|fraud|scam|cheat|dhamki|police|court|refund nahi|bewaqoof|gali|mc\b|bc\b|bsdk|porn|sex|nude/.test(
      t
    ) ||
    t.length > 400
  );
}

function catalogLine(products?: CatalogProduct[]) {
  if (!products?.length) return "";
  return catalogSummary(products, 8);
}

function emptyCatalogReply(businessName: string) {
  return `Assalam o Alaikum! ${businessName} ki taraf se.\n\nAbhi dashboard pe koi product add nahi hai, is liye list / photos / order nahi le sakta.\n\nMalik: Dashboard → Products pe naam + price (+ photo) add karein. Add hote hi main WhatsApp pe catalog bhej dunga.`;
}

function catalogReply(businessName: string, products?: CatalogProduct[]) {
  const catalog = catalogLine(products);
  if (!catalog) return emptyCatalogReply(businessName);
  return `${businessName} ke products:\n${catalog}\n\nJo lena ho naam + quantity likhein. Size wale item pe size bhi bata dein.`;
}

function imagesForNames(products: CatalogProduct[] | undefined, names: string[]) {
  const catalog = products || [];
  if (!names.length) return [];
  return catalog
    .filter((p) =>
      names.some(
        (n) =>
          p.name.toLowerCase() === n.toLowerCase() ||
          p.name.toLowerCase().includes(n.toLowerCase()) ||
          n.toLowerCase().includes(p.name.toLowerCase())
      )
    )
    .filter((p) => p.image_url)
    .slice(0, 10)
    .map((p) => ({
      path: p.image_url as string,
      caption: formatProductCard(p),
      productName: p.name,
      productId: p.id,
      seeMore: needsSeeMore(p.description),
    }));
}

async function llmAgent(client: OpenAI, models: string[], params: AgentParams): Promise<AgentResponse> {
  const catalog = params.products || [];
  const catalogJson = catalog.map((p, i) => ({
    n: i + 1,
    id: p.id,
    name: p.name,
    price: p.price,
    category: p.category || "",
    sizes: parseSizeOptions(p.sizes),
    description_short: (p.description || "").slice(0, 120),
    has_photo: Boolean(p.image_url),
  }));
  const stats = params.orderStats;
  const wallets = [
    params.easypaisaNumber ? `Easypaisa: ${params.easypaisaNumber}` : null,
    params.jazzcashNumber ? `JazzCash: ${params.jazzcashNumber}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  const historyTurns = (params.conversationHistory || []).length;
  const replyLang = inferCustomerLanguage(params.message, params.conversationHistory);
  const system = `You are ${params.agentName}, the AI brain of WhatsApp shop "${params.businessName}".
Chat like ChatGPT / Groq chat: natural, helpful, smart. Answer the customer's exact question first.

LANGUAGE (must follow):
- Reply ONLY in: ${replyLang}
- English question → English answer. Roman Urdu → Roman Urdu. Switch if they ask.

CONVERSATION STYLE:
- Free chat. If they ask about discount, delivery, COD, timing, size, price, stock — answer directly like a human shopkeeper.
- Use SHOP_NOTES for discount/delivery/COD policy. If notes don't mention discount, say honestly you can check with the shop / offer a small courtesy if reasonable, or say current prices are as listed — do NOT invent fake huge discounts.
- NEVER reply with a canned menu like "I can help you / Main madad kar sakta hoon + full catalog" unless they asked what you sell or said hi with no other intent.
- Thanks/ok → short ack only.
- Do not restart the conversation or re-greet every turn. History has ${historyTurns} messages.

CATALOG:
- DASHBOARD_PRODUCTS is the only truth (numbered n=1,2,3...). Never invent products/prices.
- "shoes hain?" → check category/name. If none, clearly say not available in dashboard.
- If you already asked quantity and customer says "sirf 1" / "1" / "1 chahiye", that is QUANTITY=1 for the CURRENT product — never switch to catalog item #1.
- "Ye wala" after a product card means THAT product — continue the order (ask next missing field), do not resend full details dump unless asked.
- If customer asks details/photo of ONE product → reply only about that product. send_photos=true and photo_product_names=[that one name ONLY]. NEVER send all product photos.
- List with: 1) Name — Rs.price only when they ask catalog/category. Keep short.
- Never write "sending photo" / "photo bhej raha hoon".

ORDERS:
- When customer says they want a product ("chahiye", "I want", "order"), lock that product into parsed_order.products and continue collecting size (if any), name, address, payment. Do not restart or dump menus.
- Sizes required when product has sizes → ask, save variant "Size 8".
- Collect: items+qty+size, name, address, payment. Confirm with yes before should_create_order=true.
- Cancel request → intent cancel_order / human_handoff, needs_human=true.

Return ONLY JSON:
{"reply":"string","intent":"greeting|product_inquiry|place_order|confirm_order|cancel_order|order_status|general|human_handoff","should_create_order":false,"send_photos":false,"photo_product_names":[],"needs_human":false,"parsed_order":{"customer_name":null,"phone":null,"address":null,"payment_method":null,"products":[{"name":"","quantity":1,"variant":null}],"notes":null}}`;

  const user = `DASHBOARD_PRODUCTS: ${JSON.stringify(catalogJson)}
SHOP_NOTES: ${params.instructions || "(none)"}
WALLET_NUMBERS: ${wallets || "(not set)"}
CUSTOMER_WHATSAPP_NAME: ${params.customerName || "(unknown)"}
PENDING_ORDER: ${JSON.stringify(params.pendingOrder || null)}
REFERRED_PRODUCT: ${params.referredProduct ? JSON.stringify(params.referredProduct) : "null"}
SELECTED_CATEGORY: ${params.selectedCategory || "null"}
ORDER_STATS: ${stats ? JSON.stringify(stats) : "null"}
REPLY_IN: ${replyLang}
LATEST_CUSTOMER_MESSAGE: ${params.message}`;

  const history = (params.conversationHistory || []).slice(-16).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const modelList = models.length ? models : ["openai/gpt-oss-20b"];
  let raw = "{}";
  let lastErr: unknown = null;
  for (const model of modelList) {
    try {
      const completion = await client.chat.completions.create(
        {
          model,
          temperature: 0.55,
          max_tokens: 900,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            ...history,
            { role: "user", content: user },
          ],
        },
        { timeout: 16000 }
      );
      raw = completion.choices[0]?.message?.content || "{}";
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const msg = String((err as { message?: string })?.message || err);
      const retryable = /model_not_found|does not exist|404|not have access/i.test(msg);
      console.error(`Groq model failed (${model}):`, msg.slice(0, 200));
      if (!retryable) throw err;
    }
  }
  if (lastErr) throw lastErr;

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
          ? (rawOrder.products as Array<{ name?: string; quantity?: number; variant?: string | null }>).map((p) => ({
              name: String(p.name || ""),
              quantity: Number(p.quantity) || 1,
              variant: p.variant ? String(p.variant) : null,
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

  let pending = mergeOrder(params.pendingOrder, extracted, params.products);
  if (params.referredProduct && !pending.products.length && /selected catalog|#\d+|^\d+$/i.test(params.message)) {
    pending = mergeOrder(
      params.pendingOrder,
      {
        customer_name: null,
        phone: null,
        address: null,
        products: [
          {
            name: params.referredProduct.name,
            quantity: 1,
            variant: null,
            unit_price: params.referredProduct.price,
          },
        ],
        subtotal: null,
        delivery_fee: null,
        discount: null,
        total: null,
        payment_method: null,
        payment_status: null,
        notes: null,
      },
      params.products
    );
  }

  const intent = ([
    "greeting",
    "place_order",
    "confirm_order",
    "cancel_order",
    "order_status",
    "product_inquiry",
    "payment_inquiry",
    "delivery_inquiry",
    "general",
    "human_handoff",
  ].includes(String(parsed.intent))
    ? parsed.intent
    : "general") as AgentIntent;

  const namedForPhotos = findProductInText(params.message.toLowerCase(), params.products) || params.referredProduct;
  const wantPhotos =
    (Boolean(parsed.send_photos) || isPhotoRequest(params.message.toLowerCase()) || isDetailOrPhotoAsk(params.message.toLowerCase())) &&
    intent !== "place_order" &&
    intent !== "confirm_order";
  const photoNames = Array.isArray(parsed.photo_product_names)
    ? (parsed.photo_product_names as unknown[]).map((n) => String(n)).filter(Boolean)
    : namedForPhotos
      ? [namedForPhotos.name]
      : [];
  // Never expand empty names to full catalog
  const send_images =
    wantPhotos && photoNames.length ? imagesForNames(params.products, photoNames.slice(0, 3)) : undefined;

  const confirmed = Boolean(parsed.should_create_order);
  const complete =
    pending.products.length > 0 &&
    Boolean(pending.customer_name) &&
    Boolean(pending.address) &&
    Boolean(pending.payment_method) &&
    !nextMissingField(pending, params.products);

  return {
    intent,
    reply,
    parsed_order: pending.products.length || pending.customer_name || pending.address ? pending : extracted,
    should_create_order: confirmed && complete,
    order_id: null,
    confidence: 0.9,
    needs_human: intent === "human_handoff" || intent === "cancel_order" || Boolean(parsed.needs_human),
    send_images: send_images?.length ? send_images : undefined,
  };
}

function localAgent(params: {
  message: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  pendingOrder?: Record<string, unknown> | null;
  products?: CatalogProduct[];
  customerName?: string | null;
  businessName: string;
  instructions?: string | null;
  referredProduct?: CatalogProduct | null;
  orderStats?: OrderStats;
  selectedCategory?: string | null;
  easypaisaNumber?: string | null;
  jazzcashNumber?: string | null;
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
  const en = inferCustomerLanguage(text, params.conversationHistory) === "English";

  if (isCancelRequest(lower)) {
    return {
      intent: "human_handoff",
      reply: en
        ? "Got it — I've flagged your cancel request. Our team will check the dashboard right away."
        : "Theek hai — cancel request flag kar di. Team dashboard pe abhi check karegi.",
      parsed_order: previous.products.length ? previous : null,
      confidence: 1,
      should_create_order: false,
      order_id: null,
      needs_human: true,
    };
  }

  if (/discount|off\b|sasta|kam price|offer|deal/.test(lower) && !buyAsk) {
    const notes = (params.instructions || "").trim();
    const fromNotes = /discount|offer|%/i.test(notes)
      ? notes.split(/\n/).find((l) => /discount|offer|%/i.test(l)) || notes.slice(0, 180)
      : null;
    return {
      intent: "general",
      reply: en
        ? fromNotes
          ? `About discounts: ${fromNotes}`
          : "Prices on the catalog are current. For a special discount I can flag the shop owner — tell me which item and quantity, and I'll note it."
        : fromNotes
          ? `Discount ke bare mein: ${fromNotes}`
          : "Abhi listed prices chal rahe hain. Special discount ke liye bataein kaunsa item + quantity — main shop owner ko note forward kar dunga.",
      parsed_order: previous.products.length ? previous : null,
      confidence: 0.9,
      ...empty,
      skip_media: true,
    };
  }

  // Number pick / referred product from "2"
  if (params.referredProduct && /selected catalog|^\d{1,2}$/.test(lower)) {
    const p = params.referredProduct;
    const sizes = parseSizeOptions(p.sizes);
    return {
      intent: "place_order",
      reply: en
        ? `You picked ${p.name} — Rs.${p.price}.${sizes.length ? ` Which size? (${sizes.join(", ")})` : " How many do you want?"}`
        : `Aap ne ${p.name} choose kiya — Rs.${p.price}.${sizes.length ? ` Size bataein (${sizes.join(", ")})` : " Quantity bataein?"}`,
      parsed_order: {
        ...previous,
        products: [{ name: p.name, quantity: 1, variant: null, unit_price: p.price }],
        notes: sizes.length ? "size" : previous.customer_name ? previous.notes : "naam",
      },
      confidence: 0.95,
      ...empty,
    };
  }

  const cat =
    params.selectedCategory ||
    detectCategoryFromMessage(text, params.products);
  if (cat && !buyAsk && !photoAsk) {
    const list = productsInCategory(params.products || [], cat);
    if (!list.length) {
      return {
        intent: "product_inquiry",
        reply: en
          ? `Sorry — "${cat}" is not available in our dashboard catalog right now.`
          : `Maazrat — dashboard pe "${cat}" available nahi hai.`,
        parsed_order: previous.products.length ? previous : null,
        confidence: 0.95,
        ...empty,
        skip_media: true,
      };
    }
    const lines = list
      .map((p, i) => `${i + 1}) ${p.name} — Rs.${p.price}`)
      .join("\n");
    return {
      intent: "product_inquiry",
      reply: en
        ? `Yes, we have ${cat}:\n${lines}\n\nReply with the number (e.g. 1) or the product name.`
        : `Ji, ${cat} available hain:\n${lines}\n\nNumber likhein (jaise 1) ya product naam.`,
      parsed_order: previous.products.length ? previous : null,
      confidence: 0.95,
      ...empty,
    };
  }

  // Asked for a named item that isn't in catalog
  if (
    /\b(hai|hain|available|have|stock)\b/.test(lower) &&
    !namedProduct &&
    !cat &&
    (params.products || []).length > 0 &&
    !isCatalogAsk(lower) &&
    !isGreeting(lower)
  ) {
    const maybe = lower.replace(/[^a-z0-9\s]/gi, " ").trim();
    if (maybe.length > 2 && !isSmallTalk(lower)) {
      // only if they mentioned a goods-like word not in catalog
      const goods = maybe.match(/\b([a-z]{3,})\b/gi) || [];
      const unknown = goods.find((w) => {
        const wl = w.toLowerCase();
        if (["have", "hai", "hain", "available", "stock", "please", "want", "kuch", "kya", "the", "and", "for"].includes(wl))
          return false;
        return !(params.products || []).some(
          (p) =>
            p.name.toLowerCase().includes(wl) ||
            (p.category || "").toLowerCase().includes(wl) ||
            (p.description || "").toLowerCase().includes(wl)
        );
      });
      if (unknown && /shoes?|bag|watch|shirt|suit|phone|laptop|joota/i.test(unknown)) {
        return {
          intent: "product_inquiry",
          reply: en
            ? `I checked our dashboard — "${unknown}" is not available right now.`
            : `Dashboard check kiya — "${unknown}" abhi available nahi hai.`,
          parsed_order: previous.products.length ? previous : null,
          confidence: 0.85,
          ...empty,
          skip_media: true,
        };
      }
    }
  }

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
          ? `Yeh photos hain. Jo lena ho uska naam + quantity likhein, size ho to size bhi.`
          : `${targets[0].name} — Rs.${targets[0].price}. Lena ho to quantity${parseSizeOptions(targets[0].sizes).length ? " aur size" : ""} likhein.`,
      parsed_order: previous.products.length ? previous : null,
      confidence: 0.95,
      ...empty,
      send_images: targets.slice(0, 10).map((p) => ({
        path: p.image_url as string,
        caption: formatProductCard(p),
        productName: p.name,
        productId: p.id,
        seeMore: needsSeeMore(p.description),
      })),
    };
  }

  if (isGreeting(lower) && !lastAsk && !buyAsk && !photoAsk && !isCatalogAsk(lower)) {
    const alreadyChatting = (params.conversationHistory || []).length > 1;
    return {
      intent: alreadyChatting ? "general" : "greeting",
      reply: alreadyChatting
        ? "Ji, boliye — kya chahiye?"
        : params.products?.length
          ? `Assalam o Alaikum! ${params.businessName} mein khush amdeed.\nNeeche categories / catalog se choose karein, ya product naam likhein.`
          : emptyCatalogReply(params.businessName),
      parsed_order: null,
      confidence: 0.9,
      skip_media: alreadyChatting,
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
    const missing = nextMissingField(priced, params.products);
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
      ? en
        ? `I can help with products and orders. Ask for a category (e.g. shoes), say "catalog", or type a product name.\n\n${catalog}`
        : `Main madad kar sakta hoon. Category poochhein (jaise shoes), "catalog" likhein, ya product naam.\n\n${catalog}`
      : emptyCatalogReply(params.businessName),
    parsed_order: previous.products.length ? previous : null,
    confidence: 0.6,
    ...empty,
  };
}

function inferCustomerLanguage(
  message: string,
  history?: Array<{ role: "user" | "assistant"; content: string }>
) {
  const t = message.toLowerCase();
  if (/english mein|in english|speak english|talk in english|reply in english|english me baat|english please/.test(t)) {
    return "English";
  }
  if (/urdu mein|roman urdu|urdu me baat/.test(t)) {
    return "Roman Urdu";
  }
  // Prefer last explicit language preference from history
  for (const m of [...(history || [])].reverse()) {
    if (m.role !== "user") continue;
    const c = m.content.toLowerCase();
    if (/english mein|in english|speak english|talk in english|reply in english/.test(c)) return "English";
    if (/urdu mein|roman urdu|urdu me baat/.test(c)) return "Roman Urdu";
    break;
  }
  const recentUsers = (history || []).filter((m) => m.role === "user").slice(-3).map((m) => m.content);
  const sample = `${message} ${recentUsers.join(" ")}`;
  if (/[\u0600-\u06FF]/.test(sample)) return "Urdu";
  const roman =
    /\b(hai|hain|kya|chahiye|chahye|krdo|karo|mujhe|mera|apna|shukriya|meherbani|kitna|kitne|dikhao|batao|acha|theek|ji)\b/i.test(
      sample
    );
  const english =
    /\b(the|please|want|order|show|thanks|thank you|hello|hi|can you|would|this|that|how much|available|have|do you|shoes|yes|no)\b/i.test(
      sample
    );
  if (english && !roman) return "English";
  if (roman && !english) return "Roman Urdu";
  if (english && roman) {
    // mixed: lean to whichever words dominate in latest message
    if (/\b(have|available|please|shoes|want|order|thanks|hello)\b/i.test(t)) return "English";
    return "Roman Urdu";
  }
  if (/^[a-z0-9\s.,!?'"-]+$/i.test(message.trim()) && message.trim().split(/\s+/).length >= 1) {
    return "English";
  }
  return "the same language as the customer message";
}

function isSmallTalk(lower: string) {
  return /^(ok+|okay|theek|theek hai|shukriya|thanks|thank you|ok thank you|ok thanks|jee|ji|acha|nice|great|cool|alright|done thanks)[\s!.]*$/i.test(
    lower.trim()
  );
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

function isAnsweringDetails(
  lower: string,
  text: string,
  lastAsk: "naam" | "address" | "payment" | "size" | null
) {
  if (lastAsk === "naam") return !isPhotoRequest(lower) && !isStatsQuery(lower);
  if (lastAsk === "address") return looksLikeAddress(text) || lastAsk === "address";
  if (lastAsk === "payment") return looksLikePayment(text);
  if (lastAsk === "size") return Boolean(extractSizeToken(text));
  return false;
}

function formatOrderNote(order: ParsedOrderData) {
  return [
    "Order note ho gaya:",
    order.customer_name ? `Name: ${order.customer_name}` : "Name: —",
    order.products.length
      ? `Items: ${order.products.map((p) => `${p.quantity}x ${p.name}${p.variant ? ` (${p.variant})` : ""}`).join(", ")}`
      : null,
    order.total != null ? `Total: Rs.${order.total}` : null,
    order.address ? `Address: ${order.address}` : null,
    order.payment_method ? `Payment: ${order.payment_method}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function nextMissingField(
  order: ParsedOrderData,
  catalog?: CatalogProduct[]
): { key: "naam" | "address" | "payment" | "size"; prompt: string } | null {
  if (order.products.length) {
    const missingSize = order.products.find((item) => {
      const prod = catalog?.find((p) => p.name.toLowerCase() === item.name.toLowerCase());
      const sizes = parseSizeOptions(prod?.sizes);
      return sizes.length > 0 && !item.variant;
    });
    if (missingSize) {
      const prod = catalog?.find((p) => p.name.toLowerCase() === missingSize.name.toLowerCase());
      const sizes = parseSizeOptions(prod?.sizes);
      return {
        key: "size",
        prompt: `${missingSize.name} ka size (${sizes.join(", ")})`,
      };
    }
  }
  if (!order.customer_name) return { key: "naam", prompt: "poora naam (sirf naam, address nahi)" };
  if (!order.address) return { key: "address", prompt: "delivery address" };
  if (!order.payment_method) return { key: "payment", prompt: "payment method (COD / Easypaisa / JazzCash)" };
  return null;
}

function lastAssistantAsk(pending?: Record<string, unknown> | null): "naam" | "address" | "payment" | "size" | null {
  const notes = String(pending?.notes || "");
  if (notes === "naam" || notes === "address" || notes === "payment" || notes === "size") return notes;
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
  const labeled = lower.match(/(?:quantity|qty|kitni|kitna|sirf|only)\s*[:=]?\s*(\d{1,4})/);
  if (labeled) return parseInt(labeled[1], 10);
  const x = lower.match(/(\d{1,4})\s*(?:x|×|\*|pieces?|pcs|qty)/);
  if (x) return parseInt(x[1], 10);
  const want = lower.match(/(\d{1,4})\s*(?:chahye|chahiye|chahiye|piece|pcs)?/);
  if (want && /chahye|chahiye|sirf|only|quantity|qty|piece|pcs|x\b/.test(lower)) {
    return parseInt(want[1], 10);
  }
  for (const [word, n] of Object.entries(URDU_QTY)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return n;
  }
  return null;
}

function isQuantityReply(message: string, history?: Array<{ role: string; content: string }>, pending?: Record<string, unknown> | null) {
  const t = message.toLowerCase().trim();
  const qty = extractQuantity(t);
  const bareNum = t.match(/^(\d{1,4})\s*[.!]?$/);
  const hasPendingProduct =
    Array.isArray(pending?.products) && (pending!.products as unknown[]).length > 0;
  const lastAskQty = [...(history || [])]
    .reverse()
    .find((m) => m.role === "assistant")
    ?.content.toLowerCase()
    .match(/quantity|kitni|kitna|kitne|how many|qty/);
  if (qty != null && (hasPendingProduct || lastAskQty || /sirf|only|chahye|chahiye|quantity|qty/.test(t))) {
    return qty;
  }
  if (bareNum && (hasPendingProduct || lastAskQty)) {
    return parseInt(bareNum[1], 10);
  }
  return null;
}

function lastOfferedProduct(
  history: Array<{ role: string; content: string }> | undefined,
  products?: CatalogProduct[]
) {
  if (!products?.length) return null;
  for (const m of [...(history || [])].reverse()) {
    if (m.role !== "assistant") continue;
    const hit = findProductInText(m.content.toLowerCase(), products);
    if (hit) return hit;
  }
  return null;
}

function pendingProductName(pending?: Record<string, unknown> | null) {
  const list = Array.isArray(pending?.products) ? (pending!.products as Array<{ name?: string }>) : [];
  return list[0]?.name || null;
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
  const mergedProducts = extracted.products.length
    ? extracted.products.map((item) => {
        const prev = base.products.find((p) => p.name.toLowerCase() === item.name.toLowerCase());
        return {
          ...item,
          quantity: item.quantity || prev?.quantity || 1,
          variant: item.variant || prev?.variant || null,
          unit_price: item.unit_price ?? prev?.unit_price ?? null,
        };
      })
    : base.products.map((item) => {
        const extra = extracted.products.find((p) => p.name.toLowerCase() === item.name.toLowerCase());
        return extra ? { ...item, variant: extra.variant || item.variant } : item;
      });
  if (!extracted.products.length && extracted.notes === null) {
    const token = extraVariantFromExtracted(extracted);
    if (token && mergedProducts.length) {
      mergedProducts[mergedProducts.length - 1] = {
        ...mergedProducts[mergedProducts.length - 1],
        variant: mergedProducts[mergedProducts.length - 1].variant || token,
      };
    }
  }
  return matchCatalog(
    {
      customer_name: extracted.customer_name || base.customer_name,
      phone: extracted.phone || base.phone,
      address: extracted.address || base.address,
      products: mergedProducts,
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

function extraVariantFromExtracted(_extracted: ParsedOrderData): string | null {
  return null;
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
  awaiting: "naam" | "address" | "payment" | "size" | null = null,
  referredProduct?: CatalogProduct | null
): ParsedOrderData | null {
  const phoneMatch = text.match(/(\+?92|0)?3\d{9}/);
  const lower = text.toLowerCase();
  const payment = extractPayment(lower);
  const qty = extractQuantity(lower);
  const collectingDetails = awaiting === "naam" || awaiting === "address" || awaiting === "payment";
  const collectingSize = awaiting === "size";
  const useReferred = Boolean(referredProduct) && (!collectingDetails || qty != null || isPointingAtProduct(lower));
  const chosen = findProductInText(lower, products) || (useReferred ? referredProduct : null);
  const address = extractAddress(text, awaiting === "address");
  const name = extractName(text, awaiting === "naam");
  const size = extractSizeForProduct(text, chosen, products, collectingSize);

  const productsList =
    chosen && (!collectingDetails || qty != null || isPointingAtProduct(lower) || collectingSize)
      ? [
          {
            name: chosen.name,
            quantity: qty || 1,
            variant: size,
            unit_price: chosen.price,
          },
        ]
      : [];

  if (!phoneMatch && !productsList.length && !address && !payment && !name && !size) return null;
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

function extractSizeToken(text: string): string | null {
  const labeled = text.match(/(?:size|sz)\s*[:=]?\s*([A-Za-z0-9]{1,4})/i);
  if (labeled) return labeled[1];
  const bare = text.trim().match(/^([A-Za-z0-9]{1,4})$/);
  return bare ? bare[1] : null;
}

function extractSizeForProduct(
  text: string,
  chosen: CatalogProduct | null | undefined,
  catalog?: CatalogProduct[],
  awaitingSize?: boolean
): string | null {
  const token = extractSizeToken(text);
  if (!token) return null;
  const sizes = parseSizeOptions(chosen?.sizes) || [];
  if (sizes.length) {
    const hit = sizes.find((s) => s.toLowerCase() === token.toLowerCase());
    if (hit) return `Size ${hit}`;
    if (!awaitingSize) return null;
  }
  if (awaitingSize || /size/i.test(text)) return `Size ${token}`;
  const anySized = catalog?.some((p) => parseSizeOptions(p.sizes).length);
  if (anySized && awaitingSize) return `Size ${token}`;
  return null;
}
