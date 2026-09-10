process.env.GROQ_API_KEY = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.AI_API_KEY = "";

const product = {
  id: "p1",
  name: "Sportiva Swing Tee",
  price: 29,
  description: "tee",
  image_url: "https://example.com/t.jpg",
};

const pending = {
  customer_name: "Mohsin Abid",
  phone: null,
  address: "Kashmir Block, Allama Iqbal Town, Lahore",
  products: [{ name: "Sportiva Swing Tee", quantity: 1, variant: null, unit_price: 29 }],
  subtotal: 29,
  delivery_fee: 0,
  discount: 0,
  total: 29,
  payment_method: "cod",
  payment_status: "unpaid",
  notes: "revise",
};

const chatHistory = [
  { role: "assistant" as const, content: "Ab apna delivery address bhej dein." },
  { role: "user" as const, content: "Kashmir Block, Allama Iqbal Town, Lahore" },
  {
    role: "assistant" as const,
    content:
      "Order: 1x Sportiva Swing Tee — Rs.29\nNaam: Mohsin Abid\nAddress: Kashmir Block, Allama Iqbal Town, Lahore\nPayment: COD\n\nConfirm ke liye yes likhein.",
  },
  { role: "user" as const, content: "No" },
  {
    role: "assistant" as const,
    content:
      "Theek hai — order abhi confirm NAHI hua.\nOrder: 1x Sportiva Swing Tee — Rs.29\nNaam: Mohsin Abid\nAddress: Kashmir Block\nPayment: COD\n\nKya change karna hai?\n1) Product\n2) Naam\n3) Address\n4) Payment\nTheek ho to \"yes\" likhein.",
  },
];

const base = {
  conversationHistory: chatHistory,
  businessName: "Test Shop",
  agentName: "Order Desk",
  products: [product],
  pendingOrder: pending,
  customerName: "Mohsin Abid",
  groqApiKey: "skip",
};

async function run() {
  const { processAgentMessage } = await import("../src/lib/ai/agent");
  const yes = await processAgentMessage({ ...base, message: "Yes" });
  const hello = await processAgentMessage({
    ...base,
    message: "Hello",
    conversationHistory: [...chatHistory, { role: "user", content: "Yes" }],
  });
  const loveHist = [
    {
      role: "assistant" as const,
      content: "Theek hai — draft order cancel. Koi order place nahi hua. Naya order: catalog number ya product naam likhein.",
    },
    { role: "user" as const, content: "shop ka name kiya hai?" },
    { role: "assistant" as const, content: "XStore Pk" },
    { role: "user" as const, content: "tum kn ho?" },
  ];
  const afterCancel = {
    conversationHistory: loveHist,
    businessName: "XStore Pk",
    agentName: "Order Assistant",
    products: [{ ...product, name: "Full Stack Developer", price: 500000 }],
    pendingOrder: null,
    customerName: "Customer",
    groqApiKey: "skip",
  };
  const who = await processAgentMessage({ ...afterCancel, message: "tum kn ho?" });
  const love = await processAgentMessage({
    ...afterCancel,
    message: "mujhy tum sy piyar ho gya hai",
    conversationHistory: [...loveHist, { role: "assistant", content: who.reply }],
  });
  const shopName = await processAgentMessage({
    ...afterCancel,
    conversationHistory: [loveHist[0]],
    message: "shop ka name kiya hai?",
  });
  const payPending = {
    customer_name: "Baloch",
    phone: null,
    address: "Ghazi Ghat Punjab Pakistan",
    products: [{ name: "Sportiva Swing Tee", quantity: 1, variant: null, unit_price: 29 }],
    subtotal: 29,
    delivery_fee: 0,
    discount: 0,
    total: 29,
    payment_method: null,
    payment_status: null,
    notes: "payment",
  };
  const storeMidOrder = await processAgentMessage({
    ...base,
    pendingOrder: payPending,
    message: "apny store ka name batao",
    groqApiKey: "skip",
  });
  const catalogHist = [
    {
      role: "assistant" as const,
      content: "1) Red Shirt — Rs.1000\n2) 3pc Womens Stitched Silk Printed Suit — Rs.2430",
    },
  ];
  const pickNine = await processAgentMessage({
    conversationHistory: catalogHist,
    businessName: "XStream-Store-Pk",
    agentName: "Order Desk",
    products: [
      product,
      { id: "p9", name: "3pc Womens Stitched Silk Printed Suit", price: 2430, description: "suit" },
    ],
    pendingOrder: payPending,
    customerName: "Baloch",
    groqApiKey: "skip",
    message: "2",
  });
  const checks = [
    ["yes confirms", yes.should_create_order === true && yes.intent === "confirm_order"],
    ["yes keeps name", yes.parsed_order?.customer_name === "Mohsin Abid"],
    ["hello does not ask naam", !/poora naam|full name|sirf naam/i.test(hello.reply)],
    ["hello keeps name", /Mohsin Abid/i.test(hello.reply) || hello.parsed_order?.customer_name === "Mohsin Abid"],
    ["no duplicate greeting dump", !/assalam o alaikum/i.test(hello.reply)],
    ["shop name only", /xstream-store-pk/i.test(shopName.reply) && !/payment method/i.test(shopName.reply)],
    ["who are you no how can i help today", !/how can i help you today/i.test(who.reply)],
    ["love does not resume payment", !/payment method|easypaisa|1x full stack/i.test(love.reply)],
    ["love does not recreate order", !love.should_create_order && !(love.parsed_order?.products?.length)],
    [
      "store name mid checkout not payment",
      /xstream-store-pk/i.test(storeMidOrder.reply) && !/payment method|easypaisa|apna naam/i.test(storeMidOrder.reply),
    ],
    ["catalog pick asks qty", /quantity kitni chahiye|how many pieces/i.test(pickNine.reply)],
    ["catalog pick ignores old name", pickNine.parsed_order?.customer_name !== "Baloch"],
    ["catalog pick ignores old address", !/ghazi ghat/i.test(String(pickNine.parsed_order?.address || ""))],
  ] as Array<[string, boolean]>;
  for (const [label, ok] of checks) {
    console.log(ok ? "PASS" : "FAIL", label);
    if (!ok) {
      console.log("  yes:", yes.intent, yes.should_create_order, yes.reply.slice(0, 180));
      console.log("  hello:", hello.intent, hello.reply.slice(0, 220));
      console.log("  who:", who.reply.slice(0, 180));
      console.log("  love:", love.reply.slice(0, 180), love.parsed_order);
      console.log("  store:", storeMidOrder.reply.slice(0, 180));
      console.log("  pick:", pickNine.reply.slice(0, 220), pickNine.parsed_order);
    }
  }
  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

run();
export {};
