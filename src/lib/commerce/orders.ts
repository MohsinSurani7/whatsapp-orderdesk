import { addCartLine, type CartLine } from "@/lib/commerce/cart";
import { calculateDeliveryFee } from "@/lib/commerce/delivery";
import { orderIdempotencyKey } from "@/lib/commerce/idempotency";
import { deductStock, restoreStock } from "@/lib/commerce/inventory";
import { recordInventoryTxn } from "@/lib/commerce/ledger";
import { calculateOrderTotals, lineSubtotal } from "@/lib/commerce/money";
import { canCancelOrder, canRestoreInventoryOnCancel, canTransitionOrderStatus } from "@/lib/commerce/order-status";
import { normalizePhone } from "@/lib/commerce/phone";
import { nowIso, uid, withDbLock, type DatabaseShape, type LocalOrder } from "@/lib/db/store";
import type { ParsedOrderData, PaymentMethod, PaymentStatus } from "@/types/database";

export type CreateOrderOk = {
  success: true;
  orderId: string;
  orderNumber: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  tax: number;
  total: number;
  paymentMethod: string;
  orderStatus: string;
};

export type CreateOrderFail = {
  success: false;
  code: string;
  message: string;
  productId?: string;
  productName?: string;
  availableQuantity?: number;
};

export type CreateOrderResult = CreateOrderOk | CreateOrderFail;

function catalogPrice(
  db: DatabaseShape,
  businessId: string,
  line: { product_id?: string | null; name: string; unit_price: number | null }
) {
  const hit = db.products.find(
    (p) =>
      p.business_id === businessId &&
      (line.product_id ? p.id === line.product_id : p.name.toLowerCase() === line.name.toLowerCase())
  );
  if (!hit || !hit.is_active) return { product: hit, price: null as number | null };
  return { product: hit, price: hit.price };
}

function linesFromParsed(order: ParsedOrderData): CartLine[] {
  return (order.products || []).map((p) => ({
    product_id: p.product_id ?? null,
    sku: p.sku ?? null,
    name: p.name,
    quantity: Math.max(1, Math.floor(p.quantity || 1)),
    variant: p.variant,
    unit_price: p.unit_price,
  }));
}

function nextOrderNumber(db: DatabaseShape, businessId: string) {
  const prefix = (db.businesses.find((b) => b.id === businessId)?.invoice_prefix || "ORD").replace(/-+$/, "");
  const count = db.orders.filter((o) => o.business_id === businessId).length;
  return `${prefix}-${String(count + 1).padStart(5, "0")}`;
}

function alreadyRestocked(db: DatabaseShape, orderId: string) {
  return (db.inventory_transactions || []).some(
    (t) => t.reference_id === orderId && (t.type === "cancel" || t.type === "return")
  );
}

export async function createWhatsAppOrder(params: {
  conversationId: string;
  businessId: string;
  customerPhone: string;
  orderData: ParsedOrderData;
  shopNotes?: string | null;
  businessName?: string;
}): Promise<CreateOrderResult> {
  return withDbLock(async (db) => {
    const lines = linesFromParsed(params.orderData);
    if (!lines.length) {
      return { success: false, code: "CART_EMPTY", message: "Cart empty hai." };
    }

    const priced: CartLine[] = [];
    for (const line of lines) {
      const { product, price } = catalogPrice(db, params.businessId, line);
      if (!product) {
        return {
          success: false,
          code: "PRODUCT_NOT_FOUND",
          message: `${line.name} catalog mein nahi mila.`,
          productName: line.name,
        };
      }
      if (!product.is_active) {
        return {
          success: false,
          code: "PRODUCT_INACTIVE",
          message: `${product.name} ab sale ke liye available nahi.`,
          productName: product.name,
          productId: product.id,
        };
      }
      if (price == null) {
        return { success: false, code: "PRODUCT_NOT_FOUND", message: `${line.name} price missing.` };
      }
      if (line.unit_price != null && Math.abs(line.unit_price - price) >= 0.01) {
        return {
          success: false,
          code: "PRICE_CHANGED",
          message: `${product.name} ki price ab Rs.${price} hai. Dobara confirm karein.`,
          productId: product.id,
          productName: product.name,
        };
      }
      priced.push({
        ...line,
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        unit_price: price,
      });
    }

    const deliveryFee = calculateDeliveryFee({
      businessName: params.businessName,
      shopNotes: params.shopNotes,
      address: params.orderData.address,
    });
    const totals = calculateOrderTotals({
      items: priced,
      deliveryFee,
      discount: params.orderData.discount,
      tax: 0,
    });

    const key = orderIdempotencyKey({
      businessId: params.businessId,
      conversationId: params.conversationId,
      lines: priced,
      address: params.orderData.address,
      payment: params.orderData.payment_method,
    });
    db.idempotency_keys = db.idempotency_keys || [];
    const prior = db.idempotency_keys.find((k) => k.business_id === params.businessId && k.key === key);
    if (prior?.order_id) {
      const existing = db.orders.find((o) => o.id === prior.order_id && o.order_status !== "cancelled");
      if (existing) {
        return {
          success: true,
          orderId: existing.id,
          orderNumber: existing.order_number,
          subtotal: existing.subtotal,
          discount: existing.discount,
          deliveryFee: existing.delivery_fee,
          tax: existing.tax,
          total: existing.total,
          paymentMethod: existing.payment_method,
          orderStatus: existing.order_status,
        };
      }
    }

    const stock = deductStock(
      db.products,
      priced.map((l) => ({ product_id: l.product_id, name: l.name, quantity: l.quantity })),
      params.businessId
    );
    if (!stock.ok) {
      return {
        success: false,
        code: stock.error.code,
        message:
          stock.error.code === "OUT_OF_STOCK"
            ? `${stock.error.productName} out of stock hai.`
            : `${stock.error.productName} ke sirf ${stock.error.available} pieces available hain (aap ne ${stock.error.requested} mange).`,
        productName: stock.error.productName,
        availableQuantity: stock.error.available,
      };
    }
    db.products = stock.products;

    const phone = normalizePhone(params.orderData.phone || params.customerPhone) || params.customerPhone;
    let customer = db.customers.find(
      (c) =>
        c.business_id === params.businessId &&
        (normalizePhone(c.phone) === phone ||
          normalizePhone(c.whatsapp_id || "") === phone ||
          c.phone === params.customerPhone)
    );
    if (!customer) {
      customer = {
        id: uid(),
        business_id: params.businessId,
        name: params.orderData.customer_name || "WhatsApp Customer",
        phone,
        email: null,
        address: params.orderData.address,
        notes: null,
        whatsapp_id: params.customerPhone,
        total_orders: 0,
        total_spent: 0,
        created_at: nowIso(),
      };
      db.customers.push(customer);
    } else {
      if (params.orderData.customer_name) customer.name = params.orderData.customer_name;
      customer.phone = phone || customer.phone;
      if (params.orderData.address) customer.address = params.orderData.address;
      customer.whatsapp_id = params.customerPhone;
    }

    const conv = db.conversations.find((c) => c.id === params.conversationId);
    if (conv) conv.customer_id = customer.id;

    const paymentMethod = (params.orderData.payment_method || "cod") as PaymentMethod;
    const paymentStatus: PaymentStatus = paymentMethod === "cod" || paymentMethod === "cash" ? "unpaid" : "unpaid";

    const orderId = uid();
    const orderNumber = nextOrderNumber(db, params.businessId);
    const order: LocalOrder = {
      id: orderId,
      business_id: params.businessId,
      order_number: orderNumber,
      customer_id: customer.id,
      subtotal: totals.subtotal,
      discount: totals.discount,
      delivery_fee: totals.delivery_fee,
      tax: totals.tax,
      total: totals.total,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      order_status: "pending",
      delivery_address: params.orderData.address || customer.address,
      customer_note:
        params.orderData.notes && !["naam", "address", "payment", "size", "revise"].includes(String(params.orderData.notes))
          ? params.orderData.notes
          : null,
      internal_note: null,
      source: "whatsapp",
      whatsapp_conversation_id: params.conversationId,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    db.orders.push(order);

    for (const line of priced) {
      const product = db.products.find((p) => p.id === line.product_id);
      db.order_items.push({
        id: uid(),
        order_id: orderId,
        product_id: line.product_id ?? null,
        product_name: line.name,
        sku: line.sku ?? product?.sku ?? null,
        quantity: line.quantity,
        unit_price: line.unit_price ?? 0,
        subtotal: lineSubtotal(line.quantity, line.unit_price ?? 0),
        variant: line.variant,
      });
      if (product && product.stock != null) {
        recordInventoryTxn(db, {
          businessId: params.businessId,
          productId: product.id,
          type: "sale",
          quantity: -line.quantity,
          previousStock: product.stock + line.quantity,
          newStock: product.stock,
          referenceType: "order",
          referenceId: orderId,
        });
      }
    }

    customer.total_orders += 1;
    customer.total_spent += totals.total;
    if (conv) {
      conv.pending_order_data = null;
      conv.status = "active";
      conv.last_order_idempotency = key;
    }
    db.idempotency_keys.push({
      id: uid(),
      business_id: params.businessId,
      key,
      order_id: orderId,
      created_at: nowIso(),
    });
    db.notifications.push({
      id: uid(),
      business_id: params.businessId,
      title: "New WhatsApp Order",
      message: `Order ${orderNumber} received via WhatsApp AI agent.`,
      type: "order",
      read: false,
      created_at: nowIso(),
    });

    return {
      success: true,
      orderId,
      orderNumber,
      subtotal: totals.subtotal,
      discount: totals.discount,
      deliveryFee: totals.delivery_fee,
      tax: totals.tax,
      total: totals.total,
      paymentMethod,
      orderStatus: "pending",
    };
  });
}

function mutateCancelOrder(
  db: DatabaseShape,
  params: {
    orderId: string;
    businessId: string;
    customerId?: string | null;
    actorType?: string;
    actorId?: string | null;
  }
): { ok: boolean; code?: string } {
  const order = db.orders.find((o) => o.id === params.orderId && o.business_id === params.businessId);
  if (!order) return { ok: false, code: "ORDER_NOT_FOUND" };
  if (params.customerId && order.customer_id !== params.customerId) return { ok: false, code: "ORDER_NOT_OWNED" };
  if (order.order_status === "cancelled" || order.order_status === "returned") return { ok: true };
  if (!canCancelOrder(order.order_status) && order.order_status !== "out_for_delivery") {
    return { ok: false, code: "INVALID_ORDER_STATE" };
  }
  const prev = order.order_status;
  order.order_status = "cancelled";
  order.updated_at = nowIso();
  if (canRestoreInventoryOnCancel(prev) && !alreadyRestocked(db, order.id)) {
    const items = db.order_items.filter((i) => i.order_id === order.id);
    db.products = restoreStock(
      db.products,
      items.map((i) => ({ product_id: i.product_id, name: i.product_name, quantity: i.quantity })),
      params.businessId
    );
    for (const item of items) {
      if (!item.product_id) continue;
      const product = db.products.find((p) => p.id === item.product_id);
      recordInventoryTxn(db, {
        businessId: params.businessId,
        productId: item.product_id,
        type: "cancel",
        quantity: item.quantity,
        previousStock: product?.stock != null ? product.stock - item.quantity : null,
        newStock: product?.stock ?? null,
        referenceType: "order",
        referenceId: order.id,
        actorType: params.actorType,
        actorId: params.actorId,
      });
    }
  }
  const customer = db.customers.find((c) => c.id === order.customer_id);
  if (customer) {
    customer.total_spent = Math.max(0, Number(customer.total_spent) - Number(order.total));
  }
  return { ok: true };
}

export async function cancelOrderAndRestock(params: {
  orderId: string;
  businessId: string;
  customerId?: string | null;
  actorType?: string;
  actorId?: string | null;
}): Promise<{ ok: boolean; code?: string }> {
  return withDbLock(async (db) => mutateCancelOrder(db, params));
}

export async function transitionOrderStatus(params: {
  orderId: string;
  businessId: string;
  nextStatus: string;
  actorId?: string | null;
}) {
  return withDbLock(async (db) => {
    const order = db.orders.find((o) => o.id === params.orderId && o.business_id === params.businessId);
    if (!order) return { ok: false as const, code: "ORDER_NOT_FOUND" };
    if (!canTransitionOrderStatus(order.order_status, params.nextStatus)) {
      return { ok: false as const, code: "INVALID_ORDER_STATE" };
    }
    if (params.nextStatus === "cancelled") {
      return mutateCancelOrder(db, {
        orderId: params.orderId,
        businessId: params.businessId,
        actorType: "staff",
        actorId: params.actorId,
      });
    }
    if (params.nextStatus === "returned" && !alreadyRestocked(db, order.id)) {
      const items = db.order_items.filter((i) => i.order_id === order.id);
      db.products = restoreStock(
        db.products,
        items.map((i) => ({ product_id: i.product_id, name: i.product_name, quantity: i.quantity })),
        params.businessId
      );
      for (const item of items) {
        if (!item.product_id) continue;
        const product = db.products.find((p) => p.id === item.product_id);
        recordInventoryTxn(db, {
          businessId: params.businessId,
          productId: item.product_id,
          type: "return",
          quantity: item.quantity,
          previousStock: product?.stock != null ? product.stock - item.quantity : null,
          newStock: product?.stock ?? null,
          referenceType: "order",
          referenceId: order.id,
          actorType: "staff",
          actorId: params.actorId,
        });
      }
    }
    order.order_status = params.nextStatus;
    order.updated_at = nowIso();
    return { ok: true as const };
  });
}

export function customerOwnsOrder(
  db: DatabaseShape,
  order: LocalOrder,
  customerPhone: string,
  customerId?: string | null
) {
  if (customerId && order.customer_id === customerId) return true;
  const customer = db.customers.find((c) => c.id === order.customer_id && c.business_id === order.business_id);
  if (!customer) return false;
  const a = normalizePhone(customerPhone);
  return normalizePhone(customer.phone) === a || normalizePhone(customer.whatsapp_id || "") === a;
}

export function mergeCartProducts(existing: CartLine[], incoming: CartLine[]): CartLine[] {
  return incoming.reduce((acc, line) => addCartLine(acc, line), existing.map((l) => ({ ...l })));
}
