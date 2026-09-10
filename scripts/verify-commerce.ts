import { addCartLine, removeCartLine, setCartLineQty } from "../src/lib/commerce/cart";
import { calculateDeliveryFee } from "../src/lib/commerce/delivery";
import { deductStock, restoreStock } from "../src/lib/commerce/inventory";
import { orderIdempotencyKey } from "../src/lib/commerce/idempotency";
import { calculateOrderTotals } from "../src/lib/commerce/money";
import { canTransitionOrderStatus } from "../src/lib/commerce/order-status";
import { customerOwnsOrder } from "../src/lib/commerce/orders";
import { normalizePhone } from "../src/lib/commerce/phone";
import type { LocalProduct } from "../src/lib/db/store";

function product(partial: Partial<LocalProduct> & { id: string; name: string }): LocalProduct {
  return {
    business_id: "b1",
    sku: null,
    description: null,
    price: 1000,
    cost: null,
    stock: 5,
    image_url: null,
    category: null,
    sizes: null,
    is_active: true,
    created_at: new Date().toISOString(),
    ...partial,
  };
}

function assert(name: string, ok: boolean) {
  if (!ok) throw new Error(`FAIL ${name}`);
  console.log("PASS", name);
}

const shoes = { name: "Black Shoes", quantity: 2, variant: "Size 42", unit_price: 2500, product_id: "p-shoes" };
const shirt = { name: "White Shirt", quantity: 1, variant: "L", unit_price: 1800, product_id: "p-shirt" };

let cart = addCartLine([], shoes);
cart = addCartLine(cart, shirt);
assert("cart two lines", cart.length === 2);
cart = setCartLineQty(cart, { name: "Black Shoes" }, 3);
assert("cart qty 3", cart.find((l) => l.name === "Black Shoes")?.quantity === 3);
cart = removeCartLine(cart, { name: "White Shirt" });
assert("shirt removed", cart.length === 1 && cart[0].name === "Black Shoes" && cart[0].quantity === 3);

const totals = calculateOrderTotals({ items: [{ quantity: 2, unit_price: 2500 }, { quantity: 1, unit_price: 1800 }], deliveryFee: 0 });
assert("totals", totals.subtotal === 6800 && totals.total === 6800);
assert("free delivery", calculateDeliveryFee({ shopNotes: "Free delivery pory Pakistan" }) === 0);

const catalog = [product({ id: "p-shoes", name: "Black Shoes", stock: 5 })];
const a = deductStock(catalog, [{ product_id: "p-shoes", name: "Black Shoes", quantity: 3 }], "b1");
assert("deduct 3 from 5", a.ok && a.products[0].stock === 2);
const b = deductStock(a.products, [{ product_id: "p-shoes", name: "Black Shoes", quantity: 3 }], "b1");
assert("second 3 fails", !b.ok && b.error.code === "INSUFFICIENT_STOCK");
const restored = restoreStock(a.products, [{ product_id: "p-shoes", name: "Black Shoes", quantity: 3 }], "b1");
assert("cancel restock", restored[0].stock === 5);

const emptyTry = deductStock([product({ id: "p1", name: "Cap", stock: 0 })], [{ product_id: "p1", name: "Cap", quantity: 1 }], "b1");
assert("out of stock", !emptyTry.ok);

const snapA = [product({ id: "p-shoes", name: "Black Shoes", stock: 5 })];
const first = deductStock(snapA, [{ product_id: "p-shoes", name: "Black Shoes", quantity: 3 }], "b1");
const second = deductStock(first.ok ? first.products : snapA, [{ product_id: "p-shoes", name: "Black Shoes", quantity: 3 }], "b1");
assert("concurrent serialized 3+3", first.ok && !second.ok && (first.products[0].stock ?? 0) === 2);

assert("phones match", normalizePhone("03106282966") === normalizePhone("+923106282966"));
assert("order status block delivered->confirmed", !canTransitionOrderStatus("delivered", "confirmed"));
assert("pending can cancel", canTransitionOrderStatus("pending", "cancelled"));

const k1 = orderIdempotencyKey({ businessId: "b1", conversationId: "c1", lines: cart, address: "Lahore", payment: "cod" });
const k2 = orderIdempotencyKey({ businessId: "b1", conversationId: "c1", lines: cart, address: "Lahore", payment: "cod" });
assert("idempotency stable", k1 === k2);

const owned = customerOwnsOrder(
  {
    users: [],
    businesses: [],
    members: [],
    customers: [{ id: "cu1", business_id: "b1", name: "A", phone: "923111111111", email: null, address: null, notes: null, whatsapp_id: "923111111111", total_orders: 1, total_spent: 1, created_at: "" }],
    products: [],
    orders: [],
    order_items: [],
    conversations: [],
    messages: [],
    whatsapp_configs: [],
    templates: [],
    subscriptions: [],
    notifications: [],
  },
  {
    id: "o1",
    business_id: "b1",
    order_number: "XSP-1",
    customer_id: "cu1",
    subtotal: 1,
    discount: 0,
    delivery_fee: 0,
    tax: 0,
    total: 1,
    payment_method: "cod",
    payment_status: "unpaid",
    order_status: "pending",
    delivery_address: null,
    customer_note: null,
    internal_note: null,
    source: "whatsapp",
    whatsapp_conversation_id: "c1",
    created_at: "",
    updated_at: "",
  },
  "03111111111",
  "cu1"
);
const stolen = customerOwnsOrder(
  {
    users: [],
    businesses: [],
    members: [],
    customers: [{ id: "cu1", business_id: "b1", name: "A", phone: "923111111111", email: null, address: null, notes: null, whatsapp_id: "923111111111", total_orders: 1, total_spent: 1, created_at: "" }],
    products: [],
    orders: [],
    order_items: [],
    conversations: [],
    messages: [],
    whatsapp_configs: [],
    templates: [],
    subscriptions: [],
    notifications: [],
  },
  {
    id: "o1",
    business_id: "b1",
    order_number: "XSP-1",
    customer_id: "cu1",
    subtotal: 1,
    discount: 0,
    delivery_fee: 0,
    tax: 0,
    total: 1,
    payment_method: "cod",
    payment_status: "unpaid",
    order_status: "pending",
    delivery_address: null,
    customer_note: null,
    internal_note: null,
    source: "whatsapp",
    whatsapp_conversation_id: "c1",
    created_at: "",
    updated_at: "",
  },
  "03222222222",
  "cu-other"
);
assert("owner can see order", owned);
assert("other customer denied", !stolen);

console.log("All commerce checks passed.");
