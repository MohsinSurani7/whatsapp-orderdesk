import { processAgentMessage } from "../src/lib/ai/agent";

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

const history = [
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
  conversationHistory: history,
  businessName: "Test Shop",
  agentName: "Order Desk",
  products: [product],
  pendingOrder: pending,
  customerName: "Mohsin Abid",
  groqApiKey: "skip",
};

async function run() {
  const yes = await processAgentMessage({ ...base, message: "Yes" });
  const hello = await processAgentMessage({
    ...base,
    message: "Hello",
    conversationHistory: [...history, { role: "user", content: "Yes" }],
  });
  const checks = [
    ["yes confirms", yes.should_create_order === true && yes.intent === "confirm_order"],
    ["yes keeps name", yes.parsed_order?.customer_name === "Mohsin Abid"],
    ["hello does not ask naam", !/poora naam|full name|sirf naam/i.test(hello.reply)],
    ["hello keeps name", /Mohsin Abid/i.test(hello.reply) || hello.parsed_order?.customer_name === "Mohsin Abid"],
    ["no duplicate greeting dump", !/assalam o alaikum/i.test(hello.reply)],
  ] as Array<[string, boolean]>;
  for (const [label, ok] of checks) {
    console.log(ok ? "PASS" : "FAIL", label);
    if (!ok) {
      console.log("  yes:", yes.intent, yes.should_create_order, yes.reply.slice(0, 180));
      console.log("  hello:", hello.intent, hello.reply.slice(0, 220));
    }
  }
  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

run();
