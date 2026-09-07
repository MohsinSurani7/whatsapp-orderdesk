import OpenAI from "openai";
import type {
  AgentIntent,
  AgentResponse,
  ParsedOrderData,
  PaymentMethod,
  PaymentStatus,
} from "@/types/database";

const SYSTEM_PROMPT = `You are a WhatsApp order assistant for a small business in Pakistan.
You communicate in Urdu/English mix (Roman Urdu is fine) — natural, friendly, professional.

Your job:
1. Greet customers warmly
2. Take orders conversationally — ask for missing details (name, products, quantity, size, address, payment method)
3. Confirm order details before finalizing
4. Answer order status, product, payment, delivery questions
5. Hand off to human if customer is angry or request is too complex

When extracting order data, handle messages like:
"Ali 03001234567 ko 2 black tshirts XL bhejni hain, total 4000, COD, Johar Town Lahore"

Always respond with valid JSON only:
{
  "intent": "greeting|place_order|confirm_order|cancel_order|order_status|product_inquiry|payment_inquiry|delivery_inquiry|general|human_handoff",
  "reply": "Your WhatsApp reply message to the customer",
  "parsed_order": {
    "customer_name": null,
    "phone": null,
    "address": null,
    "products": [{"name": "", "quantity": 1, "variant": null, "unit_price": null}],
    "subtotal": null,
    "delivery_fee": null,
    "discount": null,
    "total": null,
    "payment_method": null,
    "payment_status": null,
    "notes": null
  },
  "should_create_order": false,
  "confidence": 0.0,
  "needs_human": false
}

Rules:
- Keep replies short (WhatsApp style, 2-4 lines max)
- If order details incomplete, ask ONE question at a time
- Only set should_create_order=true when customer explicitly confirms (yes/confirm/theek hai/ok)
- Use confidence 0-1
- payment_method values: cash, cod, bank_transfer, card, easypaisa, jazzcash, other
- payment_status values: unpaid, partially_paid, paid, refunded`;

function getAIClient() {
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

export async function processAgentMessage(params: {
  message: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  businessName: string;
  agentName: string;
  products?: Array<{ name: string; price: number }>;
  pendingOrder?: Record<string, unknown> | null;
  customerName?: string | null;
}): Promise<AgentResponse> {
  const client = getAIClient();

  const contextMessage = [
    `Business: ${params.businessName}`,
    `Agent name: ${params.agentName}`,
    params.customerName ? `Customer: ${params.customerName}` : null,
    params.products?.length
      ? `Available products: ${params.products.map((p) => `${p.name} (Rs.${p.price})`).join(", ")}`
      : null,
    params.pendingOrder
      ? `Pending order being built: ${JSON.stringify(params.pendingOrder)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (!client) {
    return fallbackAgent(params.message, params.pendingOrder);
  }

  try {
    const completion = await client.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: contextMessage },
        ...params.conversationHistory.slice(-10),
        { role: "user", content: params.message },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return fallbackAgent(params.message, params.pendingOrder);

    const parsed = JSON.parse(raw) as AgentResponse;
    return {
      intent: parsed.intent || "general",
      reply: parsed.reply || "Shukriya! Main aap ki madad kar raha hoon.",
      parsed_order: parsed.parsed_order || null,
      should_create_order: parsed.should_create_order || false,
      order_id: null,
      confidence: parsed.confidence ?? 0.5,
      needs_human: parsed.needs_human || false,
    };
  } catch (error) {
    console.error("AI agent error:", error);
    return fallbackAgent(params.message, params.pendingOrder);
  }
}

function fallbackAgent(
  message: string,
  pendingOrder?: Record<string, unknown> | null
): AgentResponse {
  const lower = message.toLowerCase();
  const confirmWords = ["yes", "confirm", "theek", "ok", "haan", "done", "finalize"];
  const isConfirm = confirmWords.some((w) => lower.includes(w));

  if (isConfirm && pendingOrder) {
    return {
      intent: "confirm_order",
      reply: "Shukriya! Aap ka order confirm ho gaya hai. Jald deliver karenge.",
      parsed_order: pendingOrder as unknown as ParsedOrderData,
      should_create_order: true,
      order_id: null,
      confidence: 0.7,
      needs_human: false,
    };
  }

  const parsed = parseOrderFromText(message);

  return {
    intent: parsed ? "place_order" : "general",
    reply: parsed
      ? `Order samajh aa gaya! ${parsed.customer_name ? `Name: ${parsed.customer_name}` : "Aap ka naam?"}\n${parsed.products.map((p) => `${p.quantity}x ${p.name}`).join(", ")}\n${parsed.total ? `Total: Rs.${parsed.total}` : ""}\nConfirm karne ke liye "yes" likhein.`
      : "Assalam o Alaikum! Order ke liye product, quantity, address aur payment method batayein.",
    parsed_order: parsed,
    should_create_order: false,
    order_id: null,
    confidence: parsed ? 0.6 : 0.3,
    needs_human: false,
  };
}

export function parseOrderFromText(text: string): ParsedOrderData | null {
  const phoneMatch = text.match(/(\+?92|0)?3\d{9}/);
  const totalMatch = text.match(/total\s*:?\s*(\d[\d,]*)/i);
  const codMatch = /\bCOD\b/i.test(text);
  const qtyMatch = text.match(/(\d+)\s*(?:x|×|\*)?\s*([\w\s]+?)(?:\s|,|$)/i);

  if (!phoneMatch && !qtyMatch && !totalMatch) return null;

  return {
    customer_name: extractName(text),
    phone: phoneMatch?.[0] ?? null,
    address: extractAddress(text),
    products: qtyMatch
      ? [{ name: qtyMatch[2].trim(), quantity: parseInt(qtyMatch[1]), variant: null, unit_price: null }]
      : [],
    subtotal: totalMatch ? parseFloat(totalMatch[1].replace(/,/g, "")) : null,
    delivery_fee: null,
    discount: null,
    total: totalMatch ? parseFloat(totalMatch[1].replace(/,/g, "")) : null,
    payment_method: codMatch ? "cod" : null,
    payment_status: codMatch ? ("unpaid" as PaymentStatus) : null,
    notes: null,
  };
}

function extractName(text: string): string | null {
  const match = text.match(/^([A-Za-z]+(?:\s+[A-Za-z]+)?)\s/);
  return match?.[1] ?? null;
}

function extractAddress(text: string): string | null {
  const towns = text.match(/(?:Town|Block|Phase|Sector|Lahore|Karachi|Islamabad|Rawalpindi)[\w\s,]*/i);
  return towns?.[0]?.trim() ?? null;
}

export type { AgentIntent, AgentResponse, ParsedOrderData, PaymentMethod };
