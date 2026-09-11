process.env.GROQ_API_KEY = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.AI_API_KEY = "";

const catalog = Array.from({ length: 9 }, (_, i) => ({
  id: `n${i + 1}`,
  name: i === 6 ? "M10 Digital Display Earbuds" : i === 7 ? "Air 31 Wireless Bluetooth Earbuds" : `Item ${i + 1}`,
  price: i === 6 ? 2100 : i === 7 ? 2500 : 100 + i,
  description: "x",
}));

const list = catalog.map((p, i) => `${i + 1}) ${p.name} — Rs.${p.price}`).join("\n");

const shop = {
  businessName: "Test Shop",
  agentName: "Order Desk",
  products: catalog,
  customerName: "Profile",
  groqApiKey: "skip",
};

async function step(history: Array<{ role: "user" | "assistant"; content: string }>, pending: unknown, message: string) {
  const { processAgentMessage } = await import("../src/lib/ai/agent");
  return processAgentMessage({
    ...shop,
    conversationHistory: history,
    pendingOrder: pending as Record<string, unknown> | null,
    message,
  });
}

async function run() {
  const { processAgentMessage } = await import("../src/lib/ai/agent");
  let history: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "assistant", content: `Test Shop ke products:\n${list}\n\nJo lena ho uska NUMBER ya naam likhein (jaise 8).` },
  ];
  let pending: unknown = null;

  const r7 = await step(history, pending, "7");
  pending = r7.parsed_order;
  history = [...history, { role: "user", content: "7" }, { role: "assistant", content: r7.reply }];

  const r2 = await step(history, pending, "2");
  pending = r2.parsed_order;
  history = [...history, { role: "user", content: "2" }, { role: "assistant", content: r2.reply }];

  const r8 = await step(history, pending, "8 wala bhi chahiye");
  pending = r8.parsed_order;
  history = [...history, { role: "user", content: "8 wala bhi chahiye" }, { role: "assistant", content: r8.reply }];

  const r1 = await step(history, pending, "1");
  pending = r1.parsed_order;
  history = [...history, { role: "user", content: "1" }, { role: "assistant", content: r1.reply }];

  const cart = await step(history, pending, "cart dikhao");
  const names = (cart.parsed_order?.products || []).map((p) => p.name);
  const qty7 = cart.parsed_order?.products?.find((p) => /M10/.test(p.name))?.quantity;
  const qty8 = cart.parsed_order?.products?.find((p) => /Air 31/.test(p.name))?.quantity;

  const checkout = await step(history, cart.parsed_order, "order place karo");
  const deliveryQ = await processAgentMessage({
    ...shop,
    conversationHistory: history,
    pendingOrder: null,
    message: "delivery details sy tumhara kya matlab?",
  });

  const checks: Array<[string, boolean]> = [
    ["7 asks qty", /quantity kitni|how many/i.test(r7.reply)],
    ["2 adds M10 x2", qty7 === 2],
    ["8 does not replace M10", /M10/.test(JSON.stringify(r8.parsed_order?.products || []))],
    ["8 asks qty", /Air 31|quantity kitni|how many/i.test(r8.reply)],
    ["cart has two lines", names.length === 2],
    ["8 qty 1", qty8 === 1],
    ["cart dikhao shows both", /M10/i.test(cart.reply) && /Air 31/i.test(cart.reply)],
    ["checkout asks name", /poora naam|full name/i.test(checkout.reply)],
    ["delivery is not a product", /delivery/i.test(deliveryQ.reply) && deliveryQ.intent === "delivery_inquiry"],
    ["no order created early", !r2.should_create_order && !r1.should_create_order],
  ];
  for (const [label, ok] of checks) {
    console.log(ok ? "PASS" : "FAIL", label);
    if (!ok) {
      console.log("  7", r7.reply.slice(0, 160), r7.parsed_order);
      console.log("  2", r2.reply.slice(0, 160), r2.parsed_order?.products);
      console.log("  8", r8.reply.slice(0, 160), r8.parsed_order?.products);
      console.log("  1", r1.reply.slice(0, 200), r1.parsed_order?.products);
      console.log("  cart", cart.reply.slice(0, 240));
      console.log("  checkout", checkout.reply.slice(0, 180));
      console.log("  delivery", deliveryQ.intent, deliveryQ.reply.slice(0, 160));
    }
  }
  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

run();
export {};
