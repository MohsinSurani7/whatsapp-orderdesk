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
import { ORDER_DESK_SHOTS, XSTREAM_STORE_FACTS, buildOrderDeskSystem } from "@/lib/ai/order-desk-prompt";
import { addCartLine, formatCartLines, removeCartLine, setCartLineQty, type CartLine } from "@/lib/commerce/cart";
import {
  attachCatalogIndex,
  isAddAnotherIntent,
  isCartBuilding,
  isCheckoutIntent,
  isDeliveryQuestion,
  parseCatalogNumber,
  parseIndexAndQuantity,
  productFromIndex,
} from "@/lib/ai/catalog-select";
import { executeAgentTool, formatCartReceipt } from "@/lib/ai/tools";

type CatalogProduct = ShopProduct;

type OrderStats = {
  total: number;
  delivered: number;
  pending: number;
  customerTotal: number;
  recentOrders?: Array<{ order_number: string; status: string; total: number; created_at: string }>;
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
  groqModel?: string | null;
  groqTemperature?: number | null;
  groqMaxTokens?: number | null;
  deliveryPolicy?: string | null;
  paymentOptions?: string | null;
  aliases?: Array<{ alias: string; product_id: string }>;
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

function getAIClient(
  shopGroqKey?: string | null,
  preferredModel?: string | null
): { client: OpenAI; model: string; models: string[] } | null {
  const groq = (shopGroqKey || process.env.GROQ_API_KEY || "").trim();
  if (looksLikeRealKey(groq)) {
    const models = [preferredModel, ...GROQ_MODELS].filter((m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i);
    return {
      client: new OpenAI({ apiKey: groq, baseURL: "https://api.groq.com/openai/v1" }),
      model: models[0],
      models,
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

  // Draft cancel: one clear reply, wipe pending. Never "flagged" + "no order exists".
  if (isCancelRequest(params.message)) {
    return draftCancelReply(params);
  }

  if (isStoreNameAsk(params.message)) {
    return storeNameReply(params);
  }

  if (isIdentityAsk(params.message)) {
    return identityReply(params);
  }

  if (isDeliveryQuestion(params.message)) {
    const keep = mergeOrder(params.pendingOrder, null, params.products);
    const policy =
      params.deliveryPolicy ||
      "Delivery Pakistan-wide available hai. Charges shop policy ke mutabiq hain — product select nahi hota sirf delivery poochne se.";
    return {
      intent: "delivery_inquiry",
      reply: policy,
      parsed_order: keep.products.length || keep.catalog_index?.length ? keep : emptyPending(),
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }

  const photoOrDetail = isPhotoRequest(params.message.toLowerCase()) || isShowOrDetailAsk(params.message.toLowerCase());
  const catalogNumberPick = resolveNumberedProductPick(
    params.message,
    params.conversationHistory,
    params.products,
    mergeOrder(params.pendingOrder, null, params.products)
  );
  if (catalogNumberPick && "invalid" in catalogNumberPick && catalogNumberPick.invalid) {
    return invalidCatalogNumberReply(params, catalogNumberPick.index);
  }
  const lastWasCatalogList = assistantHadNumberedCatalog(params.conversationHistory);
  const lastAskQty = lastAssistantAskedQuantity(params.conversationHistory);

  if (
    catalogNumberPick &&
    catalogNumberPick.product &&
    photoOrDetail &&
    !isBuyIntent(params.message.toLowerCase())
  ) {
    const hit = catalogNumberPick.product;
    return {
      intent: "product_inquiry",
      reply: formatProductCard(hit, { full: true }),
      parsed_order: params.pendingOrder ? mergeOrder(params.pendingOrder, null, params.products) : null,
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      send_images: hit.image_url
        ? [
            {
              path: hit.image_url,
              caption: formatProductCard(hit),
              productName: hit.name,
              productId: hit.id,
              seeMore: needsSeeMore(hit.description),
            },
          ]
        : undefined,
    };
  }

  const revising = String(params.pendingOrder?.notes || "") === "revise";
  if (
    catalogNumberPick?.product &&
    (isCatalogIndexPhrase(params.message) ||
      isAddAnotherIntent(params.message) ||
      (!revising && lastWasCatalogList) ||
      /product\s*\d+/i.test(params.message))
  ) {
    const combo = parseIndexAndQuantity(params.message);
    const qtyInMsg = combo?.quantity || extractQuantity(params.message);
    if (qtyInMsg && !/^\d{1,2}[.!]?\s*$/.test(params.message.trim())) {
      return lockProductForCheckout(params, catalogNumberPick.product, qtyInMsg, { fresh: false, keepCart: true });
    }
    return startFreshProductOrder(params, catalogNumberPick.product);
  }

  const declined = handleDecline(params);
  if (declined) return declined;

  // Quantity ONLY when we actually asked "how many" / "sirf 2" — not a catalog index
  const qtyReply = isQuantityReply(params.message, params.conversationHistory, params.pendingOrder);
  const offered =
    params.referredProduct ||
    lastOfferedProduct(params.conversationHistory, params.products) ||
    (pendingProductName(params.pendingOrder)
      ? findProductInText(String(pendingProductName(params.pendingOrder)).toLowerCase(), params.products)
      : null);

  const mergedPending = mergeOrder(params.pendingOrder, null, params.products);
  const pendingHit = mergedPending.pending_product_id
    ? (params.products || []).find(
        (p) => p.id === mergedPending.pending_product_id || p.name === mergedPending.pending_product_id
      )
    : null;
  if (qtyReply != null && (pendingHit || (offered && lastAskQty && !lastWasCatalogList))) {
    return lockProductForCheckout(params, pendingHit || offered!, qtyReply, { fresh: false, keepCart: true });
  }

  // Locked checkout: Groq must NOT greet / restart catalog while collecting name/address/payment
  const lockedCheckout = continueLockedOrder(params);
  if (lockedCheckout) return lockedCheckout;

  let working: AgentParams = params;
  const lowerEarly = params.message.toLowerCase();
  if (offered && !params.referredProduct && !wantsFullCatalog(lowerEarly, params.products)) {
    working = { ...params, referredProduct: offered };
  }

  const lowerMsg = working.message.toLowerCase();
  const namedUpfront = wantsFullCatalog(lowerMsg, working.products)
    ? null
    : findProductInText(lowerMsg, working.products) || working.referredProduct || offered || null;

  if (wantsFullCatalog(lowerMsg, working.products)) {
    return fullCatalogReply(working);
  }

  // "mujhy full stack wala dikhao" → ONLY that product + photo
  if (namedUpfront && isShowOrDetailAsk(lowerMsg) && !isBuyIntent(lowerMsg)) {
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
      skip_media: false,
    };
  }

  // "ye product chahiye" / buy named item / catalog number pick → lock order, don't restart catalog
  const alreadyLockedSame =
    Boolean(pendingProductName(working.pendingOrder)) &&
    namedUpfront &&
    String(pendingProductName(working.pendingOrder)).toLowerCase() === namedUpfront.name.toLowerCase();
  if (
    namedUpfront &&
    !alreadyLockedSame &&
    (isBuyIntent(lowerMsg) ||
      /yeh? (wala|wali|wale)|this one|isi|usi|le lo|order karo|order karna|place order/.test(lowerMsg))
  ) {
    return lockProductForCheckout(working, namedUpfront, extractQuantity(lowerMsg) || 1, { fresh: true });
  }

  // Category browse only when asking category list, not when a specific product is named
  const categoryHint = detectCategoryFromMessage(working.message, working.products);
  if (categoryHint && !working.selectedCategory && !namedUpfront && !isBuyIntent(lowerMsg)) {
    working = { ...working, selectedCategory: categoryHint };
  }

  const ai = getAIClient(working.groqApiKey, working.groqModel);
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

  // If LLM greets / asks "which product" while an order is already open, ignore it
  const rescued = continueLockedOrder(working, { force: true, llmReply: result });
  if (rescued) result = rescued;

  result = attachProductMedia(result, working);
  result = withShopMenus(result, working);

  if (needsStaffAttention(working.message) && !isCancelRequest(working.message)) {
    result = {
      ...result,
      needs_human: true,
      intent: "human_handoff",
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

function stripCatalogLineName(raw: string) {
  return raw
    .replace(/\s*[—–-]\s*Rs\.?[\s\d.,]+.*$/i, "")
    .replace(/\s+Rs\.?[\s\d.,]+.*$/i, "")
    .replace(/\s*·\s*size\s+.*$/i, "")
    .trim();
}

function presentedCatalogProducts(
  history: Array<{ role: string; content: string }> | undefined,
  products?: CatalogProduct[]
): CatalogProduct[] | null {
  if (!products?.length) return null;
  const last = lastAssistantContent(history);
  const rows = [...last.matchAll(/^\s*(\d+)\s*[).]\s+(.+)$/gm)];
  if (rows.length < 2) return null;
  const byIndex: CatalogProduct[] = [];
  for (const row of rows) {
    const n = parseInt(row[1], 10);
    if (!n) continue;
    const name = stripCatalogLineName(row[2]);
    const exact = products.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (exact) byIndex[n - 1] = exact;
  }
  return byIndex.length ? byIndex : null;
}

function resolveNumberedProductPick(
  message: string,
  history: Array<{ role: string; content: string }> | undefined,
  products?: CatalogProduct[],
  pending?: ParsedOrderData | null
): { index: number; product: CatalogProduct } | { index: number; product: null; invalid: true } | null {
  if (!products?.length) return null;
  const t = message.trim();
  const combo = parseIndexAndQuantity(t);
  const n = combo?.index || parseCatalogNumber(t);
  if (!n) return null;

  const lastWasList = assistantHadNumberedCatalog(history);
  const lastAskQty = lastAssistantAskedQuantity(history);
  const bare = /^\d{1,2}[.!]?\s*$/.test(t);
  if (bare && (pending?.notes === "qty" || lastAskQty)) return null;
  if (bare && !lastWasList && !pending?.catalog_index?.length) return null;

  const fromIndex = productFromIndex(n, pending, products);
  if (fromIndex) return { index: n, product: fromIndex };

  const presented = presentedCatalogProducts(history, products);
  const live = products.slice(0, 40);
  const explicit = isCatalogIndexPhrase(t) || /product\s*\d+|item\s*\d+|#\s*\d+/i.test(t) || isAddAnotherIntent(t);
  const list = presented && lastWasList ? presented : explicit || lastWasList || pending?.catalog_index?.length ? live : null;
  if (!list) return null;
  const product = list[n - 1];
  if (!product) return { index: n, product: null, invalid: true };
  return { index: n, product };
}

function invalidCatalogNumberReply(params: AgentParams, index: number): AgentResponse {
  const en = inferCustomerLanguage(params.message, params.conversationHistory) === "English";
  return {
    intent: "product_inquiry",
    reply: en
      ? `Number ${index} is not in the current catalog. Here's the list again.\n\n${catalogReply(params.businessName, params.products)}`
      : `Ye number (${index}) current catalog mein available nahi hai. Products ki list dobara:\n\n${catalogReply(params.businessName, params.products)}`,
    parsed_order: params.pendingOrder ? mergeOrder(params.pendingOrder, null, params.products) : emptyPending(),
    should_create_order: false,
    order_id: null,
    confidence: 1,
    needs_human: false,
    skip_media: true,
  };
}

function assistantHadNumberedCatalog(history?: Array<{ role: string; content: string }>) {
  const last = lastAssistantContent(history);
  return (last.match(/^\s*\d+\s*[).]/gm) || []).length >= 2;
}

function lastAssistantAskedQuantity(history?: Array<{ role: string; content: string }>) {
  if (assistantHadNumberedCatalog(history)) return false;
  const last = lastAssistantContent(history).toLowerCase();
  return /how many|kitni chahiye|kitna chahiye|kitne chahiye|quantity bata|qty bata|\bqty\b|\bquantity\b/.test(last);
}

function isCatalogIndexPhrase(message: string) {
  return (
    /\d+\s*(?:number|no\.?|#)\s*(?:wala|wali|wale)?/i.test(message) ||
    /\b(?:item|option|product)\s*\d+/i.test(message) ||
    /\b\d{1,2}\s*(?:wala|wali|wale)\b/i.test(message)
  );
}

function isRejection(message: string) {
  const t = message.trim().toLowerCase();
  return /^(no+|nahi+|na+|galat|wrong|nope|not this|ye nahi|yeh nahi|nahi yeh?|incorrect)[\s!.]*$/i.test(t);
}

function isSoftNo(message: string) {
  const t = message.trim().toLowerCase();
  if (isCancelRequest(t)) return false;
  if (isRejection(t)) return true;
  return /^(no|nahi|na)\b/.test(t) && !looksLikeAddress(t) && !extractName(t, false);
}

function lastAskedToConfirm(history?: Array<{ role: string; content: string }>) {
  const last = lastAssistantContent(history).toLowerCase();
  return /confirm ke liye|reply "yes"|reply 'yes'|reply “yes”|to confirm|yes likhein|haan likhein/.test(last);
}

function isConfirmYes(message: string) {
  const t = message.trim().toLowerCase();
  return /^(yes+|haan|han|yup|yep|ok+|okay|theek|confirm|done|bilkul)[\s!.]*$/i.test(t);
}

function isSmallTalk(message: string) {
  const t = message.trim().toLowerCase();
  if (isConfirmYes(t) || isSoftNo(t) || isCancelRequest(t)) return false;
  return /^(hi+|hello+|hey+|salam|salaam|assalam(?:o| u | o )?alaikum|yo+|thanks|thank you|shukriya|ok+|okay|theek(?: hai)?|ji|jee|acha|nice|great|cool|alright|done thanks|ok thank you|ok thanks)[\s!.]*$/i.test(
    t
  );
}

/** Identity / shop / flirt / small chat — NEVER resume checkout. */
function isStoreNameAsk(message: string) {
  const t = message.trim().toLowerCase();
  return (
    /store ka naam|shop ka naam|store ka name|shop ka name|dukaan ka naam|dukaan ka name|business ka naam|business ka name/.test(
      t
    ) ||
    /apn[aeiyy]+ store|hamara store|official store|store name|shop name/.test(t) ||
    /what(?:'s| is) (?:your |the )?store name/.test(t)
  );
}

function storeNameReply(params: AgentParams): AgentResponse {
  const keep = mergeOrder(params.pendingOrder, null, params.products);
  const cancelled = checkoutWasCancelled(params.conversationHistory);
  return {
    intent: "general",
    reply: "Hamara store XStream-Store-Pk hai.",
    parsed_order: cancelled ? emptyPending() : keep.products.length ? keep : emptyPending(),
    should_create_order: false,
    order_id: null,
    confidence: 1,
    needs_human: false,
    skip_media: true,
  };
}

function isIdentityAsk(message: string) {
  const t = message.trim().toLowerCase();
  if (isStoreNameAsk(t)) return false;
  if (isBuyIntent(t) || isCatalogAsk(t)) return false;
  if (/\b(mera naam|my name is|i am)\b/.test(t) && !/\b(apna|tumhara|your)\b/.test(t)) return false;
  return (
    /\bapn[aeiyy]+\s+(naam|name)\b/.test(t) ||
    /tumhara (naam|name)|tera naam|aap ka (naam|name)|your name|what(?:'s| is) your name/.test(t) ||
    /tum kaun|tum kn|aap kaun|aap kn|who are you|agent ho|bot ho/.test(t)
  );
}

function identityReply(params: AgentParams): AgentResponse {
  const en = inferCustomerLanguage(params.message, params.conversationHistory) === "English";
  const keep = mergeOrder(params.pendingOrder, null, params.products);
  const cancelled = checkoutWasCancelled(params.conversationHistory) || !keep.products.length;
  return {
    intent: "general",
    reply: en
      ? `I'm the XStream-Store-Pk WhatsApp assistant. I help customers browse products and place orders.`
      : `Main XStream-Store-Pk ka WhatsApp assistant hoon. Main products dikhane aur orders lene mein help karta hoon.`,
    parsed_order: cancelled ? emptyPending() : keep,
    should_create_order: false,
    order_id: null,
    confidence: 1,
    needs_human: false,
    skip_media: true,
  };
}

function isChitChatNotOrder(message: string) {
  const t = message.trim().toLowerCase();
  if (!t) return false;
  if (isBuyIntent(t) || isCatalogAsk(t) || isConfirmYes(t) || isSoftNo(t) || isCancelRequest(t)) return false;
  if (isCatalogIndexPhrase(t) || /^\d{1,2}[.!]?\s*$/.test(t)) return false;
  if (isIdentityAsk(t) || isStoreNameAsk(t)) return true;
  if (isSmallTalk(t)) return true;
  return (
    /tum kaun|tum kn|aap kaun|aap kn|who are you|what(?:'s| is) your name|agent ho|bot ho/.test(t) ||
    /piyar|pyar|love you|i love|marry|shadi|girlfriend|boyfriend|cute ho|beautiful/.test(t) ||
    /kese ho|kaise ho|kya haal|kia haal|mazak|joke|funny/.test(t)
  );
}

function checkoutWasCancelled(history?: Array<{ role: string; content: string }>) {
  for (const m of [...(history || [])].reverse()) {
    if (m.role === "assistant" && /draft (order )?cancel|that draft is cancelled|koi confirm order nahi tha|nothing was placed/i.test(m.content)) {
      return true;
    }
    if (m.role === "user" && (isBuyIntent(m.content) || isCatalogIndexPhrase(m.content) || isCatalogAsk(m.content))) {
      return false;
    }
  }
  return false;
}

function hydratePending(_params: AgentParams, pending: ParsedOrderData): ParsedOrderData {
  return {
    ...pending,
    customer_name: isBogusName(pending.customer_name) ? null : pending.customer_name,
  };
}

function orderLooksComplete(order: ParsedOrderData, catalog?: CatalogProduct[]) {
  return Boolean(order.products.length && order.customer_name && order.address && order.payment_method) &&
    !nextMissingField(order, catalog);
}

function declineOrReviseReply(pending: ParsedOrderData, en: boolean, params: AgentParams): AgentResponse {
  const snap = checkoutSnapshot(pending, en);
  return {
    intent: "place_order",
    reply: en
      ? `No problem — this order is NOT placed yet.\n${snap}\n\nWhat should I change?\n1) Product\n2) Name\n3) Address\n4) Payment\nOr type "cancel" to drop it. When it's correct, send "yes".`
      : `Theek hai — order abhi confirm NAHI hua.\n${snap}\n\nKya change karna hai?\n1) Product\n2) Naam\n3) Address\n4) Payment\nPoora khatam: "cancel". Theek ho to "yes" likhein.`,
    parsed_order: { ...pending, notes: "revise" },
    should_create_order: false,
    order_id: null,
    confidence: 1,
    needs_human: false,
    skip_media: true,
  };
}

function applyReviseChoice(message: string, pending: ParsedOrderData, params: AgentParams): AgentResponse | null {
  const t = message.toLowerCase().trim();
  const en = inferCustomerLanguage(message, params.conversationHistory) === "English";
  if (/^(1|product|item|saman|dusra|doosra|change product)/i.test(t) || /product (change|badlo|badal)/.test(t)) {
    return {
      intent: "place_order",
      reply: en
        ? "Okay — tell me the new product name or catalog number. Name/address/payment stay saved."
        : "Theek — naya product naam ya catalog number likhein. Naam/address/payment save hain.",
      parsed_order: { ...pending, products: [], notes: null },
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }
  if (/^(2|naam|name)\b/.test(t) || /change name|naam badlo|naam change/.test(t)) {
    return {
      intent: "place_order",
      reply: en ? "Sure — send your correct full name." : "Theek — sahi poora naam bhej dein.",
      parsed_order: { ...pending, customer_name: null, notes: "naam" },
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }
  if (/^(3|address)\b/.test(t) || /address (badlo|change|update)/.test(t)) {
    return {
      intent: "place_order",
      reply: en ? "Sure — send the correct delivery address." : "Theek — sahi delivery address bhej dein.",
      parsed_order: { ...pending, address: null, notes: "address" },
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }
  if (/^(4|payment)\b/.test(t) || /payment (badlo|change|update)/.test(t)) {
    return {
      intent: "place_order",
      reply: en ? `Sure — send ${paymentPrompt(params, true)}.` : `Theek — ${paymentPrompt(params, false)} bhej dein.`,
      parsed_order: { ...pending, payment_method: null, notes: "payment" },
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }
  const pay = extractPayment(t);
  if (pay) {
    const next: ParsedOrderData = { ...pending, payment_method: pay, notes: null };
    const snap = checkoutSnapshot(next, en);
    return {
      intent: "place_order",
      reply: en
        ? `${snap}\n\nUpdated. Reply "yes" to confirm, or "no" if something else is wrong.`
        : `${snap}\n\nUpdate ho gaya. Confirm ke liye "yes", warna "no" likh kar bataein kya change hai.`,
      parsed_order: next,
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }
  return null;
}

function handleDecline(params: AgentParams): AgentResponse | null {
  const pending = mergeOrder(params.pendingOrder, null, params.products);
  const en = inferCustomerLanguage(params.message, params.conversationHistory) === "English";
  const complete = orderLooksComplete(pending, params.products);
  const askedConfirm = lastAskedToConfirm(params.conversationHistory) || pending.notes === "revise";

  if (String(pending.notes || "") === "revise") {
    const choice = applyReviseChoice(params.message, pending, params);
    if (choice) return choice;
  }

  if (!isSoftNo(params.message) && !/^nahi lena\b/i.test(params.message.trim())) return null;

  if (pending.pending_product_id || pending.notes === "qty") {
    return {
      intent: "place_order",
      reply: en
        ? "Okay, that pending item is cancelled. Your cart is unchanged."
        : "Theek, woh pending item cancel. Cart same hai.",
      parsed_order: {
        ...pending,
        pending_product_id: null,
        pending_action: null,
        notes: pending.products.length ? "cart" : null,
        session_phase: pending.products.length ? "CART_BUILDING" : "BROWSING",
      },
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }

  // Confirm step: "no" means don't place — keep data, ask what to edit
  if (pending.products.length && (complete || askedConfirm)) {
    return declineOrReviseReply(pending, en, params);
  }

  // Mid-order wrong item (no name/address yet, or they rejected the product)
  if (pending.products.length) {
    return {
      intent: "place_order",
      reply: en
        ? "Okay, that product is cancelled. Send the catalog number or product name you actually want."
        : "Theek, woh product cancel. Jo chahiye uska catalog number ya naam likhein.",
      parsed_order: {
        ...pending,
        products: [],
        notes: null,
      },
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }

  return {
    intent: "general",
    reply: en
      ? "Okay. Tell me the product number or name whenever you're ready."
      : "Theek hai. Jab ready hon catalog number ya product naam likh dena.",
    parsed_order: pending.customer_name || pending.address ? pending : null,
    should_create_order: false,
    order_id: null,
    confidence: 1,
    needs_human: false,
    skip_media: true,
  };
}

function isBogusName(name?: string | null) {
  if (!name) return true;
  return /^(no+|nahi+|na+|yes|haan|han|ok+|okay|theek|galat|wrong|hi|hello|hey|thanks|shukriya)$/i.test(
    name.trim()
  );
}

function stockShortage(
  product: CatalogProduct | undefined,
  qty: number
): { left: number; over: boolean } | null {
  if (product?.stock == null || Number.isNaN(Number(product.stock))) return null;
  const left = Math.max(0, Number(product.stock));
  return { left, over: qty > left };
}

function startFreshProductOrder(params: AgentParams, product: CatalogProduct): AgentResponse {
  const numericPick = /^\d{1,2}[.!]?\s*$/.test(params.message.trim());
  const en = !numericPick && inferCustomerLanguage(params.message, params.conversationHistory) === "English";
  const shortage = stockShortage(product, 1);
  const keep = mergeOrder(params.pendingOrder, null, params.products);
  const adding =
    isAddAnotherIntent(params.message) ||
    keep.session_phase === "CART_BUILDING" ||
    keep.notes === "cart" ||
    keep.notes === "qty";
  if (shortage && shortage.left <= 0) {
    return {
      intent: "product_inquiry",
      reply: en
        ? `${product.name} is out of stock right now.`
        : `${product.name} filhal out of stock hai.`,
      parsed_order: keep.products.length ? keep : emptyPending(),
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }
  const pending = matchCatalog(
    {
      ...keep,
      products: adding ? keep.products : [],
      customer_name: adding ? keep.customer_name : null,
      address: adding ? keep.address : null,
      payment_method: adding ? keep.payment_method : null,
      notes: "qty",
      session_phase: "CART_BUILDING",
      pending_product_id: product.id || product.name,
      pending_action: "ADD_PRODUCT",
      catalog_index: keep.catalog_index,
    },
    params.products
  );
  return {
    intent: "place_order",
    action: "add_to_cart",
    reply: en
      ? `You selected ${product.name} — Rs.${product.price}.\n\nHow many pieces do you want?`
      : `Ap ne ${product.name} select kiya hai — Rs.${product.price}.\n\nQuantity kitni chahiye?`,
    parsed_order: pending,
    should_create_order: false,
    order_id: null,
    confidence: 1,
    needs_human: false,
    skip_media: true,
  };
}

function lockProductForCheckout(
  params: AgentParams,
  product: CatalogProduct,
  qty: number,
  opts?: { fresh?: boolean; keepCart?: boolean }
): AgentResponse {
  const en = inferCustomerLanguage(params.message, params.conversationHistory) === "English";
  const want = Math.max(1, qty);
  const shortage = stockShortage(product, want);
  const keepCart = opts?.keepCart || opts?.fresh === false;
  if (shortage && shortage.left <= 0) {
    return {
      intent: "product_inquiry",
      reply: en
        ? `${product.name} is out of stock right now. I can show similar items from the catalog if you want.`
        : `${product.name} filhal out of stock hai. Similar listed items dikha sakta hoon — boliye.`,
      parsed_order: keepCart ? mergeOrder(params.pendingOrder, null, params.products) : emptyPending(),
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }
  if (shortage?.over) {
    return {
      intent: "place_order",
      reply: en
        ? `Only ${shortage.left} piece(s) of ${product.name} are available. Should I lock ${shortage.left}?`
        : `${product.name} ke sirf ${shortage.left} pieces available hain. ${shortage.left} ka order karna chahenge?`,
      parsed_order: keepCart ? mergeOrder(params.pendingOrder, null, params.products) : emptyPending(),
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }
  const prev = keepCart ? mergeOrder(params.pendingOrder, null, params.products) : emptyPending();
  const added = executeAgentTool(
    "add_to_cart",
    { product_id: product.id, quantity: want },
    { businessId: "session", products: params.products || [], pending: { ...prev, pending_product_id: null } }
  );
  const pending = matchCatalog(
    {
      ...added.pending,
      catalog_index: prev.catalog_index,
      customer_name: keepCart && !isBogusName(prev.customer_name) ? prev.customer_name : null,
      address: keepCart ? prev.address : null,
      payment_method: keepCart ? prev.payment_method : null,
      session_phase: "CART_BUILDING",
      notes: "cart",
      pending_product_id: null,
      pending_action: null,
    },
    params.products
  );
  const receipt = formatCartReceipt(pending);
  return {
    intent: "place_order",
    action: "add_to_cart",
    reply: en
      ? `${receipt}\n\nAdd another item, or type "checkout" to place the order.`
      : `${receipt}\n\nAur item add karein, "cart dikhao", ya "checkout" / "order place karo" likhein.`,
    parsed_order: pending,
    should_create_order: false,
    order_id: null,
    confidence: 1,
    needs_human: false,
    skip_media: true,
  };
}

function emptyPending(): ParsedOrderData {
  return {
    customer_name: null,
    phone: null,
    address: null,
    products: [],
    subtotal: null,
    delivery_fee: null,
    discount: null,
    total: null,
    payment_method: null,
    payment_status: null,
    notes: null,
    session_phase: null,
    pending_product_id: null,
    pending_action: null,
    catalog_index: [],
  };
}

function draftCancelReply(params: AgentParams): AgentResponse {
  const en = inferCustomerLanguage(params.message, params.conversationHistory) === "English";
  const hadDraft = Boolean(pendingProductName(params.pendingOrder));
  return {
    intent: "general",
    reply: en
      ? hadDraft
        ? "Okay, the current draft order has been cancelled. No order was placed."
        : "There's no confirmed order to cancel. Send a catalog number or product name to start."
      : hadDraft
        ? "Theek hai, current draft order cancel kar diya gaya hai. Koi order place nahi hua."
        : "Koi confirm order nahi tha. Order ke liye catalog number ya product naam likh dein.",
    parsed_order: emptyPending(),
    should_create_order: false,
    order_id: null,
    confidence: 1,
    needs_human: false,
    skip_media: true,
  };
}

function wantsFullCatalog(message: string, products?: CatalogProduct[]) {
  const t = message.toLowerCase();
  if (findProductInText(t, products) && !/saary|saare|sari|tamam|all products|har product|poori (list|detail)/.test(t)) {
    return false;
  }
  if (/\b(yeh?|is|usi|this)\b/.test(t) && /detail|photo|pic|dikha/.test(t) && !/saary|saare|all|tamam|har product/.test(t)) {
    return false;
  }
  return (
    isCatalogAsk(t) ||
    /saary|saare|sari|tamam|all products|poori (list|detail)|har product|products? ki details?|details? (do|doo|den|send|bhej)|^catalog$/.test(
      t
    )
  );
}

function isShowOrDetailAsk(lower: string) {
  return (
    isDetailOrPhotoAsk(lower) ||
    /dikhao|dikha|dikha do|show me|show karo|photo bhej|pic bhej|image bhej|tasveer/.test(lower)
  );
}

function fullCatalogReply(params: AgentParams): AgentResponse {
  const products = params.products || [];
  const images = products
    .filter((p) => p.image_url)
    .slice(0, 10)
    .map((p) => ({
      path: p.image_url as string,
      caption: formatProductCard(p),
      productName: p.name,
      productId: p.id,
      seeMore: needsSeeMore(p.description),
    }));
  return {
    intent: "product_inquiry",
    reply: catalogReply(params.businessName, products),
    parsed_order: attachCatalogIndex(
      mergeOrder(params.pendingOrder, null, params.products).products.length
        ? mergeOrder(params.pendingOrder, null, params.products)
        : emptyPending(),
      products
    ),
    should_create_order: false,
    order_id: null,
    confidence: 1,
    needs_human: false,
    send_images: images.length ? images : undefined,
  };
}

function isCancelRequest(message: string) {
  const t = message.toLowerCase().trim();
  if (/^(stop|rehne do|rehny do|choro|chhoro|leave it)[\s!.]*$/.test(t)) return true;
  if (/^(nahi chahiye|nhi chahiye)[\s!.]*$/.test(t)) return true;
  return /cancel|order cancel|cancel karo|cancel krdo|cancel kar do|cancel kar den|mera order cancel|don't want|nahi chahiye order/.test(
    t
  );
}

function withShopMenus(result: AgentResponse, params: AgentParams): AgentResponse {
  if (result.skip_media) return result;
  const lower = params.message.toLowerCase();
  const orderOpen = Boolean(pendingProductName(params.pendingOrder) || result.parsed_order?.products?.length);
  // Mid-order / single-product detail / buy → no category dump menus
  if (
    orderOpen ||
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

function lastAssistantContent(history?: Array<{ role: string; content: string }>) {
  return [...(history || [])].reverse().find((m) => m.role === "assistant")?.content || "";
}

function inferCheckoutAsk(
  pending: ParsedOrderData,
  history: Array<{ role: string; content: string }> | undefined,
  catalog?: CatalogProduct[]
): "naam" | "address" | "payment" | "size" | null {
  if (String(pending.notes || "") === "qty") return null;
  const fromNotes = lastAssistantAsk(pending);
  if (fromNotes) return fromNotes;
  const last = lastAssistantContent(history).toLowerCase();
  if (/kya change karna|what should i change/.test(last)) return null;
  if (/size\b/.test(last) && /bata|share|which|ka size/.test(last)) return "size";
  if (/poora naam|full name|sirf naam|apna naam/.test(last) && !/naam:/.test(last)) return "naam";
  if (/delivery address|apna address|share.*address/.test(last) && !/payment/.test(last)) return "address";
  if (/payment method|cod|easypaisa|jazzcash/.test(last) && /share|bata|bhej/.test(last)) return "payment";
  return nextMissingField(pending, catalog)?.key ?? null;
}

function wantsToLeaveCheckout(message: string) {
  const t = message.toLowerCase();
  if (isCancelRequest(t)) return "cancel" as const;
  if (isChitChatNotOrder(t) || isOpenCustomerQuestion(t)) return "browse" as const;
  if (
    isCatalogAsk(t) ||
    /dusra product|doosra|another item|another product|change product|naya product/.test(t)
  ) {
    return "browse" as const;
  }
  return null;
}

/** Let Groq answer real questions instead of treating them as name/address. */
function isOpenCustomerQuestion(message: string) {
  const t = message.trim();
  if (t.length < 4) return false;
  if (isRejection(t) || isCancelRequest(t)) return false;
  if (/^\d{1,2}[.!]?\s*$/.test(t) || isCatalogIndexPhrase(t)) return false;
  if (looksLikeAddress(t) && looksLikePayment(t)) return false;
  if (/[?؟]/.test(t)) return true;
  if (
    /^(kya|kia|kyun|kuun|kese|kaise|kab|kahan|kitn|tum kn|aap kn|how|what|when|why|where|who|can you|could you|please tell|plz|mujhe bata|batao|suna|sunao|explain)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (isChitChatNotOrder(t)) return true;
  return (
    /\b(delivery|shipping|discount|offer|warranty|return|refund|original|copy|quality|size kaise|color|colour|timing|open|band|cod kya|easypaisa kaise|matlab|masla|problem|madad|help|available|stock|shop ka name|store ka name)\b/i.test(
      t
    ) && t.split(/\s+/).length >= 2
  );
}

function checkoutSnapshot(order: ParsedOrderData, en: boolean) {
  const items = order.products
    .map((p) => `${p.quantity}x ${p.name}${p.variant ? ` (${p.variant})` : ""}${p.unit_price != null ? ` — Rs.${p.unit_price}` : ""}`)
    .join(", ");
  if (en) {
    return [
      `Order so far: ${items || "—"}`,
      order.customer_name ? `Name: ${order.customer_name}` : null,
      order.address ? `Address: ${order.address}` : null,
      order.payment_method ? `Payment: ${order.payment_method}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Order: ${items || "—"}`,
    order.customer_name ? `Naam: ${order.customer_name}` : null,
    order.address ? `Address: ${order.address}` : null,
    order.payment_method ? `Payment: ${order.payment_method}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function paymentPrompt(params: AgentParams, en: boolean) {
  const wallets = [
    params.easypaisaNumber ? `Easypaisa ${params.easypaisaNumber}` : null,
    params.jazzcashNumber ? `JazzCash ${params.jazzcashNumber}` : null,
  ].filter(Boolean);
  const extra = wallets.length ? ` (${wallets.join(", ")})` : "";
  return en
    ? `payment method — COD / Easypaisa / JazzCash${extra}`
    : `payment method (COD / Easypaisa / JazzCash)${extra}`;
}

function continueLockedOrder(
  params: AgentParams,
  opts?: { force?: boolean; llmReply?: AgentResponse }
): AgentResponse | null {
  const leave = wantsToLeaveCheckout(params.message);
  if (leave === "browse") return null;
  if (isChitChatNotOrder(params.message)) return null;
  if (checkoutWasCancelled(params.conversationHistory) && !isBuyIntent(params.message) && !isCatalogIndexPhrase(params.message)) {
    return null;
  }

  let pending = hydratePending(params, mergeOrder(params.pendingOrder, null, params.products));
  const en = inferCustomerLanguage(params.message, params.conversationHistory) === "English";
  if (isCheckoutIntent(params.message) && pending.products.length) {
    pending = { ...pending, session_phase: "COLLECTING_CUSTOMER_NAME", notes: "naam" };
    return {
      intent: "place_order",
      action: "start_checkout",
      reply: en
        ? `${formatCartReceipt(pending)}\n\nCheckout shuru. Please share your full name.`
        : `${formatCartReceipt(pending)}\n\nCheckout shuru. Ab apna poora naam bhej dein.`,
      parsed_order: pending,
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }
  const cartEditEarly = applyCartEdit(params.message, pending, params.products);
  if (cartEditEarly) {
    pending = hydratePending(params, { ...pending, products: cartEditEarly.products, notes: cartEditEarly.products.length ? "cart" : null });
    return {
      intent: "place_order",
      action: cartEditEarly.action,
      reply: en ? cartEditEarly.replyEn : cartEditEarly.replyUr,
      parsed_order: pending,
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }
  if (String(pending.notes || "") === "qty" || pending.pending_product_id) {
    const q =
      extractQuantity(params.message.toLowerCase()) ||
      (params.message.trim().match(/^(\d{1,4})\s*[.!]?$/) ? parseInt(params.message.trim(), 10) : null);
    const prod =
      (params.products || []).find(
        (p) => p.id === pending.pending_product_id || p.name === pending.pending_product_id
      ) ||
      (pending.products[0]
        ? (params.products || []).find((p) => p.name.toLowerCase() === pending.products[0].name.toLowerCase())
        : null);
    if (q && prod) return lockProductForCheckout(params, prod, q, { fresh: false, keepCart: true });
    if (prod && !isConfirmYes(params.message) && !isCatalogIndexPhrase(params.message) && !isAddAnotherIntent(params.message)) {
      return {
        intent: "place_order",
        reply: en
          ? `You selected ${prod.name} — Rs.${prod.price}. How many pieces?`
          : `Ap ne ${prod.name} select kiya hai — Rs.${prod.price}. Quantity kitni chahiye?`,
        parsed_order: pending,
        should_create_order: false,
        order_id: null,
        confidence: 1,
        needs_human: false,
        skip_media: true,
      };
    }
  }
  if (!pending.products.length) return null;
  if (String(pending.notes || "") === "revise") {
    if (isConfirmYes(params.message) && orderLooksComplete(pending, params.products)) {
      return {
        intent: "confirm_order",
        reply: en
          ? "Thank you — confirming now. You'll get the order number once it's saved."
          : "Shukriya — order save kar raha hoon. Number save hone ke baad aayega.",
        parsed_order: { ...pending, notes: null },
        should_create_order: true,
        order_id: null,
        confidence: 1,
        needs_human: false,
        skip_media: true,
      };
    }
    const choice = applyReviseChoice(params.message, pending, params);
    if (choice) return choice;
    if (isSmallTalk(params.message)) {
      return declineOrReviseReply(pending, en, params);
    }
  }
  const awaiting = inferCheckoutAsk(pending, params.conversationHistory, params.products);

  if (leave === "cancel") {
    return draftCancelReply(params);
  }

  if (opts?.force && opts.llmReply) {
    const t = opts.llmReply.reply.toLowerCase();
    const offScript =
      /how can i help|kis product|which product|kya chahiye|assalam o alaikum|welcome back|aap kis product/.test(t) ||
      opts.llmReply.intent === "greeting";
    const llmFilled =
      Boolean(opts.llmReply.parsed_order?.customer_name) ||
      Boolean(opts.llmReply.parsed_order?.address) ||
      Boolean(opts.llmReply.parsed_order?.payment_method);
    if (!offScript && isOpenCustomerQuestion(params.message)) {
      return {
        ...opts.llmReply,
        parsed_order: pending.products.length ? pending : opts.llmReply.parsed_order,
        should_create_order: false,
        skip_media: true,
      };
    }
    if (!offScript && llmFilled && opts.llmReply.intent === "place_order") {
      return null;
    }
    if (!offScript && opts.llmReply.intent === "confirm_order") return null;
    if (!offScript && ["general", "delivery_inquiry", "payment_inquiry", "product_inquiry"].includes(opts.llmReply.intent)) {
      return null;
    }
  }

  const extracted = parseOrderFromText(
    params.message,
    params.products,
    awaiting,
    params.referredProduct || lastOfferedProduct(params.conversationHistory, params.products)
  );
  pending = mergeOrder(pending, extracted, params.products);
  pending = hydratePending(params, pending);
  if (isBogusName(pending.customer_name)) {
    pending = { ...pending, customer_name: null };
    pending = hydratePending(params, pending);
  }

  const confirming = isConfirmYes(params.message);
  const complete = !nextMissingField(pending, params.products);

  if (isSoftNo(params.message) && pending.products.length) {
    return declineOrReviseReply(pending, en, params);
  }

  if (isSmallTalk(params.message) && pending.products.length) {
    return {
      intent: "place_order",
      reply: en
        ? "Ji. Order draft saved — tell me if you want to continue, or ask anything else."
        : "Ji, boliye. Draft order save hai — continue karna ho to bataein, ya koi sawal poochhein.",
      parsed_order: pending,
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }

  if (confirming && complete && !isCartBuilding(pending) && !isSoftNo(params.message)) {
    const issues = pending.products
      .map((item) => {
        const catalogHit = (params.products || []).find(
          (p) =>
            (item.product_id && p.id === item.product_id) ||
            p.name.toLowerCase() === String(item.name || "").toLowerCase()
        );
        const shortage = stockShortage(catalogHit, item.quantity || 1);
        return { item, catalogHit, shortage };
      })
      .filter((r) => r.shortage && (r.shortage.left <= 0 || r.shortage.over));
    if (issues.length) {
      const lines = issues
        .map((r) =>
          r.shortage && r.shortage.left <= 0
            ? `${r.item.name} out of stock`
            : `${r.item.name}: ${r.shortage?.left ?? 0} available (requested ${r.item.quantity})`
        )
        .join("\n");
      const okItems = pending.products.filter((p) => !issues.some((i) => i.item.name === p.name));
      const partial = okItems.length
        ? en
          ? `\nOther items are still available:\n${formatCartLines(okItems)}\nRemove the unavailable item(s) then confirm.`
          : `\nBaaki items available hain:\n${formatCartLines(okItems)}\nUnavailable hata ke phir confirm karein.`
        : "";
      return {
        intent: "place_order",
        reply: en
          ? `Cannot confirm yet:\n${lines}${partial}`
          : `Order confirm nahi ho sakta:\n${lines}${partial}`,
        parsed_order: pending,
        should_create_order: false,
        order_id: null,
        confidence: 1,
        needs_human: false,
        skip_media: true,
      };
    }
    return {
      intent: "confirm_order",
      action: "create_order",
      reply: en
        ? "Thank you — confirming now. You'll get the order number once it's saved."
        : "Shukriya — order save kar raha hoon. Number save hone ke baad aayega.",
      parsed_order: { ...pending, notes: null },
      should_create_order: true,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }

  const missing = nextMissingField(pending, params.products);
  const snap = checkoutSnapshot(pending, en);
  if (isCartBuilding(pending) && !missing) {
    return {
      intent: "place_order",
      reply: en
        ? `${formatCartReceipt(pending)}\n\nAdd another item or type "checkout".`
        : `${formatCartReceipt(pending)}\n\nAur item add karein ya "checkout" likhein.`,
      parsed_order: { ...pending, notes: "cart", session_phase: "CART_BUILDING" },
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }
  if (missing) {
    const prompt =
      missing.key === "payment" ? paymentPrompt(params, en) : missing.prompt;
    return {
      intent: "place_order",
      reply: en
        ? `${snap}\n\nPlease share your ${prompt}.`
        : `${snap}\n\nAb apna ${prompt} bhej dein.`,
      parsed_order: { ...pending, notes: missing.key },
      should_create_order: false,
      order_id: null,
      confidence: 1,
      needs_human: false,
      skip_media: true,
    };
  }

  return {
    intent: "place_order",
    reply: en
      ? `${snap}\n\nReply "yes" to confirm this order.`
      : `${snap}\n\nConfirm ke liye "yes" likhein.`,
    parsed_order: { ...pending, notes: null },
    should_create_order: false,
    order_id: null,
    confidence: 1,
    needs_human: false,
    skip_media: true,
  };
}

function isDetailOrPhotoAsk(lower: string) {
  return (
    isPhotoRequest(lower) ||
    /detail|details|info|information|batao|bata|dikhao|dikha|show me|show karo|tell me about|more about|description|tasveer/.test(
      lower
    )
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
  const catalog = catalogSummary(products || [], 40);
  if (!catalog) return emptyCatalogReply(businessName);
  const extra =
    (products || []).length > 40
      ? `\n\nPehle 40 items. Baqi ke liye category naam likhein.`
      : "";
  return `${businessName} ke products:\n${catalog}${extra}\n\nJo lena ho uska NUMBER ya naam likhein (jaise 8).`;
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
    stock: p.stock == null ? null : Number(p.stock),
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
  const pendingNow = mergeOrder(params.pendingOrder, null, params.products);
  const checkoutOpen = pendingNow.products.length > 0;
  const missingNow = nextMissingField(pendingNow, params.products);
  const system = buildOrderDeskSystem({
    agentName: params.agentName,
    businessName: params.businessName,
    replyLang,
    historyTurns,
    checkoutOpen,
    missingField: missingNow ? missingNow.key : checkoutOpen ? "confirm" : null,
  });

  const user = `DASHBOARD_PRODUCTS: ${JSON.stringify(catalogJson)}
SHOP_NOTES: ${[XSTREAM_STORE_FACTS, params.instructions].filter(Boolean).join("\n")}
WALLET_NUMBERS: ${wallets || "(not set)"}
CUSTOMER_WHATSAPP_NAME: ${params.customerName || "(unknown)"} (NOT the order name — never copy into parsed_order.customer_name)
PENDING_ORDER: ${JSON.stringify(params.pendingOrder || null)}
RULE: PENDING_ORDER.products is the only cart. If it is empty/null, there is NO checkout. Do not recover products, name, or address from LAST_ASSISTANT or chat history.
REFERRED_PRODUCT: ${params.referredProduct ? JSON.stringify(params.referredProduct) : "null"}
SELECTED_CATEGORY: ${params.selectedCategory || "null"}
ORDER_STATS: ${stats ? JSON.stringify(stats) : "null"}
CHECKOUT_OPEN: ${checkoutOpen}
MISSING_FIELD: ${missingNow?.key || "none"}
LAST_ASSISTANT: ${JSON.stringify(lastAssistantContent(params.conversationHistory).slice(0, 800))}
REPLY_IN: ${replyLang}
LATEST_CUSTOMER_MESSAGE: ${params.message}`;

  const history = (params.conversationHistory || []).slice(-12).map((m) => ({
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
          temperature: 0.35,
          max_tokens: 1200,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "system", content: ORDER_DESK_SHOTS },
            ...history,
            { role: "user", content: user },
          ],
        },
        { timeout: 9000 }
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
  let extracted: ParsedOrderData | null = rawOrder
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

  const hadCart = mergeOrder(params.pendingOrder, null, params.products).products.length > 0;
  const awaitingLlm = lastAssistantAsk(params.pendingOrder);
  const catalogPick = resolveNumberedProductPick(
    params.message,
    params.conversationHistory,
    params.products,
    mergeOrder(params.pendingOrder, null, params.products)
  );
  const startedNow =
    isBuyIntent(params.message) ||
    Boolean(catalogPick && catalogPick.product) ||
    Boolean(findProductInText(params.message.toLowerCase(), params.products) && isBuyIntent(params.message));
  if (extracted && !hadCart && !startedNow) {
    extracted = {
      ...extracted,
      products: [],
      customer_name: awaitingLlm === "naam" ? extracted.customer_name : null,
      address: awaitingLlm === "address" ? extracted.address : null,
      payment_method: awaitingLlm === "payment" ? extracted.payment_method : null,
    };
  }
  if (
    extracted?.customer_name &&
    params.customerName &&
    extracted.customer_name.trim().toLowerCase() === params.customerName.trim().toLowerCase() &&
    awaitingLlm !== "naam"
  ) {
    extracted = { ...extracted, customer_name: null };
  }

  let pending = mergeOrder(params.pendingOrder, extracted, params.products);
  if (isBogusName(pending.customer_name)) {
    pending = { ...pending, customer_name: null };
  }
  if (catalogPick?.product && assistantHadNumberedCatalog(params.conversationHistory) && startedNow) {
    pending = mergeOrder(
      pending,
      {
        customer_name: pending.customer_name,
        phone: pending.phone,
        address: pending.address,
        products: [
          {
            name: catalogPick.product.name,
            quantity: 1,
            variant: null,
            unit_price: catalogPick.product.price,
          },
        ],
        subtotal: null,
        delivery_fee: null,
        discount: null,
        total: null,
        payment_method: pending.payment_method,
        payment_status: pending.payment_status,
        notes: pending.notes,
      },
      params.products
    );
  }

  let intent = ([
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
  if (pending.products.length && intent === "greeting") intent = "place_order";
  if (isRejection(params.message) && isBogusName(String(extracted?.customer_name || ""))) {
    pending = { ...pending, customer_name: null };
  }

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
  agentName?: string;
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

  if (isChitChatNotOrder(text)) {
    const shop = params.businessName;
    const agent = params.agentName || "Order Assistant";
    const cancelled = checkoutWasCancelled(params.conversationHistory);
    let reply: string;
    if (isStoreNameAsk(lower)) {
      reply = "Hamara store XStream-Store-Pk hai.";
    } else if (/tum kaun|tum kn|aap kaun|aap kn|who are you|agent ho|bot ho/.test(lower)) {
      reply = en
        ? `I'm ${agent} at ${shop} — I take WhatsApp orders.`
        : `Main ${agent} hoon, ${shop} ka WhatsApp order assistant. Order ke liye product naam likh dena.`;
    } else if (/piyar|pyar|love you|i love|marry|shadi|girlfriend|boyfriend/.test(lower)) {
      reply = en
        ? "That's sweet — I'm just the shop assistant though. If you want to order, send a product name."
        : "Shukriya 😊 Main shop ka assistant hoon. Order karna ho to product naam likh dena.";
    } else if (/kese ho|kaise ho|kya haal|kia haal/.test(lower)) {
      reply = en ? "Doing well — how can I help with an order?" : "Alhamdulillah theek. Boliye, kya chahiye?";
    } else {
      reply = en ? "Ji." : "Ji, boliye.";
    }
    return {
      intent: "general",
      reply,
      parsed_order: cancelled ? emptyPending() : previous.products.length ? previous : null,
      confidence: 1,
      ...empty,
      skip_media: true,
    };
  }

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

  if (isOrderTrackQuery(lower)) {
    const mine = (params.orderStats?.recentOrders || []).filter((o) =>
      ["pending", "confirmed", "processing", "preparing", "ready", "out_for_delivery"].includes(o.status)
    );
    if (!mine.length) {
      return {
        intent: "order_status",
        action: "get_order_status",
        reply: en
          ? "I don't see an active order on this WhatsApp number yet."
          : "Is WhatsApp number pe koi active order nahi mil raha.",
        parsed_order: previous.products.length ? previous : null,
        confidence: 0.95,
        ...empty,
        skip_media: true,
      };
    }
    if (mine.length === 1) {
      const o = mine[0];
      return {
        intent: "order_status",
        action: "get_order_status",
        reply: en
          ? `Your order #${o.order_number} is ${o.status}. Total Rs.${o.total}.`
          : `Aap ka order #${o.order_number} abhi ${o.status} hai. Total Rs.${o.total}.`,
        parsed_order: previous.products.length ? previous : null,
        confidence: 0.95,
        ...empty,
        skip_media: true,
      };
    }
    const list = mine.map((o) => `#${o.order_number} — Rs.${o.total} — ${o.status}`).join("\n");
    return {
      intent: "order_status",
      action: "get_order_status",
      reply: en
        ? `You have ${mine.length} active orders:\n${list}\nWhich order number should I check?`
        : `Aap ke ${mine.length} active orders hain:\n${list}\nKis order ka status chahiye? Order number likhein.`,
      parsed_order: previous.products.length ? previous : null,
      confidence: 0.95,
      ...empty,
      skip_media: true,
    };
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

function isOrderTrackQuery(lower: string) {
  if (/cart dikhao|mera order dikhao|view cart/.test(lower)) return false;
  return /mera order|meri order|order kahan|kahan pohanch|track order|order status|order kaha/.test(lower);
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
    /kya kya|menu\b|catalog|available|rate list|price list|pricelist|stock list|categor|\blist\b/.test(
      t
    )
  ) {
    return true;
  }
  const mentionsGoods = /product|products|item|items|saman|stock|catalog|menu|\blist\b/.test(t);
  const asks =
    /kn kn|kaun kaun|kons[aeiy]|konse|konsi|kya|hai|hain|dikhao|dikha|batao|bata|bhejo|bhej|bhj|send|list|detail|details|do\b/.test(
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
  if (isCartBuilding(order) && !["naam", "address", "payment", "revise"].includes(String(order.notes || ""))) {
    return null;
  }
  if (!order.customer_name) return { key: "naam", prompt: "poora naam (sirf naam, address nahi)" };
  if (!order.address) return { key: "address", prompt: "delivery address" };
  if (!order.payment_method) return { key: "payment", prompt: "payment method (COD / Easypaisa / JazzCash)" };
  return null;
}

function lastAssistantAsk(pending?: Record<string, unknown> | ParsedOrderData | null): "naam" | "address" | "payment" | "size" | null {
  const notes = String(pending?.notes || "");
  if (notes === "naam" || notes === "address" || notes === "payment" || notes === "size") return notes;
  return null;
}

function isPointingAtProduct(lower: string) {
  return /\b(yeh?|this|that|isi|usi|wala|wali|wale|same)\b/.test(lower) || /\d+\s*x\b/.test(lower);
}

export function findProductInText(lower: string, products?: CatalogProduct[]) {
  if (!products?.length) return null;
  const stop = new Set([
    "product",
    "products",
    "detail",
    "details",
    "price",
    "order",
    "item",
    "items",
    "shop",
    "send",
    "please",
    "with",
    "from",
    "this",
    "that",
    "have",
    "want",
    "nightwear",
    "dress",
    "women",
  ]);
  const byId = products.find((p) => p.id && String(p.id).length >= 4 && lower.includes(String(p.id).toLowerCase()));
  if (byId) return byId;
  const bySku = products.find((p) => p.sku && String(p.sku).length >= 3 && lower.includes(String(p.sku).toLowerCase()));
  if (bySku) return bySku;
  const sorted = [...products].sort((a, b) => b.name.length - a.name.length);
  const exact = sorted.filter((p) => p.name.length >= 3 && lower.includes(p.name.toLowerCase()));
  if (exact.length) return exact[0];
  const fuzzy = sorted.filter((p) => {
    const tokens = p.name
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ""))
      .filter((w) => w.length >= 4 && !stop.has(w));
    if (!tokens.length) return false;
    const hits = tokens.filter((w) => lower.includes(w)).length;
    if (tokens.length === 1) return hits >= 1;
    return hits >= 2;
  });
  if (fuzzy.length === 1) return fuzzy[0];
  return null;
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
  if (isCatalogIndexPhrase(lower)) return null;
  const labeled = lower.match(/(?:quantity|qty|kitni|kitna|sirf|only)\s*[:=]?\s*(\d{1,4})/);
  if (labeled) return parseInt(labeled[1], 10);
  const x = lower.match(/(\d{1,4})\s*(?:x|×|\*|pieces?|pcs|qty)\b/);
  if (x) return parseInt(x[1], 10);
  const want = lower.match(/(\d{1,4})\s*(?:chahye|chahiye|piece|pcs)\b/);
  if (want && !/\d+\s*(?:number|wala|wali)\b/.test(lower)) return parseInt(want[1], 10);
  for (const [word, n] of Object.entries(URDU_QTY)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return n;
  }
  return null;
}

function isQuantityReply(message: string, history?: Array<{ role: string; content: string }>, pending?: Record<string, unknown> | null) {
  const t = message.toLowerCase().trim();
  if (assistantHadNumberedCatalog(history) || isCatalogIndexPhrase(t)) return null;
  const qty = extractQuantity(t);
  const bareNum = t.match(/^(\d{1,4})\s*[.!]?$/);
  const lastAskQty = lastAssistantAskedQuantity(history);
  if (!lastAskQty) return null;
  if (qty != null) return qty;
  if (bareNum) return parseInt(bareNum[1], 10);
  return null;
}

function lastOfferedProduct(
  history: Array<{ role: string; content: string }> | undefined,
  products?: CatalogProduct[]
) {
  if (!products?.length) return null;
  for (const m of [...(history || [])].reverse()) {
    if (m.role !== "assistant") continue;
    if ((m.content.match(/^\s*\d+\)/gm) || []).length >= 2) continue;
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
  if (/\bcod\b/.test(lower) || /cash on delivery/.test(lower) || /\bcash\b/.test(lower)) return "cod";
  if (/easypaisa/.test(lower)) return "easypaisa";
  if (/jazzcash/.test(lower)) return "jazzcash";
  return null;
}

function extractName(text: string, awaitingName: boolean): string | null {
  if (isIdentityAsk(text) || isStoreNameAsk(text)) return null;
  const labeled = text.match(
    /(?:mera naam|mera name|my name(?: is)?|name\s*[:=]|i am|i'm)\s+([A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF\s.'-]{1,40})/i
  );
  if (labeled) {
    const name = cleanPersonName(labeled[1].split(/\b(?:aur|and|tum|kyun|ku)\b/i)[0]);
    if (name) return name;
  }
  if (!awaitingName) return null;
  if (isRejection(text) || isBogusName(text.trim())) return null;
  if (looksLikePayment(text) && looksLikeAddress(text) && !/naam|name/i.test(text)) return null;
  if (extractQuantity(text.toLowerCase()) && isBuyIntent(text.toLowerCase())) return null;
  const head = text.split(/\b(?:aur|and|,)\b/i)[0];
  if (looksLikeAddress(head) || looksLikePayment(head)) return null;
  const cleaned = cleanPersonName(
    head
      .replace(/^(mera naam|mera name|my name is|i am|i'm|main)\s+/i, "")
      .replace(/\b(hai|hoon|hun)\b/gi, "")
  );
  if (!cleaned) return null;
  if (isBogusName(cleaned)) return null;
  const words = cleaned.split(/\s+/);
  if (words.length > 5 || cleaned.length > 40) return null;
  if (/\b(order|product|address|payment|chahye|chahiye)\b/i.test(cleaned)) return null;
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
  let cleaned = text;
  const afterLabel = cleaned.split(/\baddress\b\s*(?:mera|:|yeh? hai)?/i)[1];
  if (afterLabel && afterLabel.trim().length >= 4) cleaned = afterLabel;
  cleaned = cleaned
    .replace(/payment method[\s\S]*?(?=\baddress\b|$)/gi, " ")
    .replace(/\b(cash on delivery|cod|easypaisa|jazzcash)\b/gi, " ")
    .replace(/yeh? hai mera address/gi, "")
    .replace(/mera address (yeh? hai|:)?/gi, "")
    .replace(/address\s*[:=]/gi, "")
    .replace(/['"]/g, " ")
    .replace(/\b(hai|please|plz|aur)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

function mergeOrder(
  pending: Record<string, unknown> | ParsedOrderData | null | undefined,
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
    session_phase: (pending?.session_phase as string) || null,
    pending_product_id: (pending?.pending_product_id as string) || null,
    pending_action: (pending?.pending_action as string) || null,
    catalog_index: Array.isArray(pending?.catalog_index)
      ? (pending?.catalog_index as ParsedOrderData["catalog_index"])
      : [],
  };
  if (!extracted) return matchCatalog(base, products);
  const mergedProducts = extracted.products.length
    ? extracted.products.reduce((acc, item) => {
        const idx = acc.findIndex(
          (p) =>
            p.name.toLowerCase() === item.name.toLowerCase() &&
            (!item.variant || !p.variant || (p.variant || "") === (item.variant || ""))
        );
        if (idx >= 0) {
          const next = [...acc];
          next[idx] = {
            ...next[idx],
            ...item,
            quantity: item.quantity || next[idx].quantity || 1,
            variant: item.variant || next[idx].variant || null,
            unit_price: item.unit_price ?? next[idx].unit_price ?? null,
            product_id: item.product_id ?? next[idx].product_id ?? null,
            sku: item.sku ?? next[idx].sku ?? null,
          };
          return next;
        }
        return [...acc, item];
      }, [...base.products])
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
      session_phase: extracted.session_phase || base.session_phase,
      pending_product_id: extracted.pending_product_id ?? base.pending_product_id,
      pending_action: extracted.pending_action ?? base.pending_action,
      catalog_index: extracted.catalog_index?.length ? extracted.catalog_index : base.catalog_index,
    },
    products
  );
}

function applyCartEdit(
  message: string,
  pending: ParsedOrderData,
  catalog?: CatalogProduct[]
): {
  products: ParsedOrderData["products"];
  action: "view_cart" | "remove_from_cart" | "update_cart_item" | "clear_cart";
  replyEn: string;
  replyUr: string;
} | null {
  const t = message.toLowerCase().trim();
  const cartShow = /cart dikhao|view cart|cart dikha|cart batao|mera order dikhao/.test(t);
  const cartClear = /clear cart|cart clear|cart khali|sab hata do|sari items hata/.test(t);
  if (!pending.products.length && !cartShow && !cartClear) return null;
  if (isConfirmYes(message) || isCancelRequest(message)) return null;
  if (cartShow) {
    const list = formatCartLines(pending.products);
    return {
      products: pending.products,
      action: "view_cart",
      replyEn: `Your cart:\n${list || "empty"}`,
      replyUr: `Aap ka cart:\n${list || "khali"}`,
    };
  }
  if (cartClear) {
    return {
      products: [],
      action: "clear_cart",
      replyEn: "Cart cleared. Send a product name to start again.",
      replyUr: "Cart khali kar diya. Naya product naam likhein.",
    };
  }
  const numberedRemove = t.match(/^(\d{1,2})\s*(?:number\s*)?(?:wala\s*)?(?:remove|hata)/i);
  if (numberedRemove) {
    const idx = parseInt(numberedRemove[1], 10) - 1;
    const line = pending.products[idx];
    if (line) {
      const next = pending.products.filter((_, i) => i !== idx);
      return {
        products: next,
        action: "remove_from_cart",
        replyEn: `Removed ${line.name}.\n${formatCartLines(next) || "Cart empty."}`,
        replyUr: `${line.name} hata di.\n${formatCartLines(next) || "Cart khali hai."}`,
      };
    }
  }
  const named = findProductInText(t, catalog);
  if (named && /hata do|hata den|remove|nikal do|delete/.test(t)) {
    const next = removeCartLine(pending.products as CartLine[], { name: named.name });
    return {
      products: next,
      action: "remove_from_cart",
      replyEn: `${named.name} removed.\n${formatCartLines(next) || "Cart empty."}`,
      replyUr: `${named.name} hata diya.\n${formatCartLines(next) || "Cart khali hai."}`,
    };
  }
  const qty = extractQuantity(t);
  if (named && qty && /kar do|kar den|update|quantity|qty/.test(t)) {
    const next = setCartLineQty(pending.products as CartLine[], { name: named.name }, qty);
    return {
      products: next,
      action: "update_cart_item",
      replyEn: `Updated ${named.name} to ${qty}.\n${formatCartLines(next)}`,
      replyUr: `${named.name} quantity ${qty} kar di.\n${formatCartLines(next)}`,
    };
  }
  return null;
}

function extraVariantFromExtracted(_extracted: ParsedOrderData): string | null {
  return null;
}

function matchCatalog(order: ParsedOrderData, products?: CatalogProduct[]): ParsedOrderData {
  const mapped = order.products.map((item) => {
    const name = String(item.name || "").toLowerCase();
    const hit =
      products?.find((p) => item.product_id && p.id === item.product_id) ||
      products?.find((p) => item.sku && p.sku && p.sku === item.sku) ||
      products?.find((p) => p.name.toLowerCase() === name) ||
      findProductInText(name, products);
    if (!hit) return item;
    return {
      ...item,
      name: hit.name,
      unit_price: hit.price,
      product_id: hit.id || item.product_id || null,
      sku: hit.sku || item.sku || null,
    };
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
  const chosen = collectingDetails
    ? null
    : findProductInText(lower, products) || (useReferred ? referredProduct : null);
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
