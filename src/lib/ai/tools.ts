import { addCartLine, formatCartLines, removeCartLine, setCartLineQty, type CartLine } from "@/lib/commerce/cart";
import { money } from "@/lib/commerce/money";
import type { ShopProduct } from "@/lib/catalog";
import type { ParsedOrderData } from "@/types/database";
import { slog } from "@/lib/observability/log";

export type AgentToolName =
  | "get_products"
  | "get_product"
  | "search_products"
  | "add_to_cart"
  | "remove_from_cart"
  | "update_cart_quantity"
  | "get_cart"
  | "clear_cart"
  | "start_order"
  | "update_customer_name"
  | "update_customer_phone"
  | "update_customer_address"
  | "set_payment_method"
  | "calculate_order_total"
  | "confirm_order"
  | "send_product_photos";

export type ToolContext = {
  businessId: string;
  products: ShopProduct[];
  pending: ParsedOrderData;
};

export type ToolResult = {
  ok: boolean;
  tool: AgentToolName;
  message: string;
  pending: ParsedOrderData;
  product?: ShopProduct | null;
};

function assertProduct(ctx: ToolContext, productId: string) {
  return (
    ctx.products.find((p) => p.id === productId) ||
    ctx.products.find((p) => p.name === productId) ||
    null
  );
}

export function formatCartReceipt(pending: ParsedOrderData, currency = "Rs.") {
  const lines = pending.products || [];
  if (!lines.length) return "Cart khali hai.";
  const rows = lines.map((l, i) => {
    const unit = l.unit_price ?? 0;
    const line = unit * (l.quantity || 1);
    return `${i + 1}. ${l.name}\n   Qty: ${l.quantity}\n   ${currency}${unit} × ${l.quantity} = ${currency}${money(line)}`;
  });
  const subtotal = lines.reduce((s, l) => s + (l.unit_price ?? 0) * (l.quantity || 1), 0);
  return `🛒 Aapka Cart:\n\n${rows.join("\n\n")}\n\nSubtotal: ${currency}${money(subtotal)}`;
}

export function executeAgentTool(
  tool: AgentToolName,
  args: Record<string, unknown>,
  ctx: ToolContext
): ToolResult {
  slog("AI", `Tool selected: ${tool}`, { product_id: args.product_id, quantity: args.quantity });
  const pending = { ...ctx.pending, products: [...(ctx.pending.products || [])] };
  const qty = Math.max(1, Math.floor(Number(args.quantity) || 1));

  if (tool === "get_products") {
    return { ok: true, tool, message: formatCartLines(pending.products as CartLine[]), pending };
  }

  if (tool === "get_product" || tool === "search_products" || tool === "send_product_photos") {
    const product = args.product_id ? assertProduct(ctx, String(args.product_id)) : null;
    if (!product) return { ok: false, tool, message: "Product not found in this business catalog.", pending, product: null };
    return { ok: true, tool, message: product.name, pending, product };
  }

  if (tool === "add_to_cart") {
    const product = assertProduct(ctx, String(args.product_id || ""));
    if (!product) return { ok: false, tool, message: "Invalid product for this business.", pending, product: null };
    if (product.stock != null && Number(product.stock) <= 0) {
      return { ok: false, tool, message: `${product.name} out of stock.`, pending, product };
    }
    pending.products = addCartLine(pending.products as CartLine[], {
      product_id: product.id || null,
      sku: product.sku || null,
      name: product.name,
      quantity: qty,
      variant: (args.variant as string) || null,
      unit_price: product.price,
    });
    pending.session_phase = "CART_BUILDING";
    pending.notes = "cart";
    pending.pending_product_id = null;
    pending.pending_action = null;
    slog("CART", `Added product ${product.id} quantity ${qty}`);
    return { ok: true, tool, message: formatCartReceipt(pending), pending, product };
  }

  if (tool === "remove_from_cart") {
    const product = assertProduct(ctx, String(args.product_id || ""));
    if (!product) return { ok: false, tool, message: "Product not in catalog.", pending };
    pending.products = removeCartLine(pending.products as CartLine[], { product_id: product.id, name: product.name });
    return { ok: true, tool, message: formatCartReceipt(pending), pending, product };
  }

  if (tool === "update_cart_quantity") {
    const product = assertProduct(ctx, String(args.product_id || ""));
    if (!product) return { ok: false, tool, message: "Product not in catalog.", pending };
    pending.products = setCartLineQty(pending.products as CartLine[], { product_id: product.id, name: product.name }, qty);
    return { ok: true, tool, message: formatCartReceipt(pending), pending, product };
  }

  if (tool === "get_cart") {
    return { ok: true, tool, message: formatCartReceipt(pending), pending };
  }

  if (tool === "clear_cart") {
    pending.products = [];
    pending.pending_product_id = null;
    pending.pending_action = null;
    pending.notes = null;
    pending.session_phase = "BROWSING";
    return { ok: true, tool, message: "Cart cleared.", pending };
  }

  if (tool === "start_order") {
    pending.session_phase = "COLLECTING_CUSTOMER_NAME";
    pending.notes = "naam";
    slog("ORDER", "Checkout started");
    return { ok: true, tool, message: "Checkout started.", pending };
  }

  if (tool === "update_customer_name") {
    pending.customer_name = String(args.name || "").trim() || pending.customer_name;
    return { ok: true, tool, message: "Name saved.", pending };
  }
  if (tool === "update_customer_phone") {
    pending.phone = String(args.phone || "").trim() || pending.phone;
    return { ok: true, tool, message: "Phone saved.", pending };
  }
  if (tool === "update_customer_address") {
    pending.address = String(args.address || "").trim() || pending.address;
    return { ok: true, tool, message: "Address saved.", pending };
  }
  if (tool === "set_payment_method") {
    const method = String(args.payment_method || "").toLowerCase();
    if (!["cod", "easypaisa", "jazzcash"].includes(method)) {
      return { ok: false, tool, message: "Payment method not available.", pending };
    }
    pending.payment_method = method as ParsedOrderData["payment_method"];
    return { ok: true, tool, message: "Payment saved.", pending };
  }
  if (tool === "calculate_order_total") {
    const subtotal = pending.products.reduce((s, l) => s + (l.unit_price ?? 0) * (l.quantity || 1), 0);
    pending.subtotal = subtotal;
    pending.total = subtotal + (pending.delivery_fee ?? 0);
    return { ok: true, tool, message: `Total ${pending.total}`, pending };
  }
  if (tool === "confirm_order") {
    pending.session_phase = "CONFIRMING";
    pending.notes = null;
    return { ok: true, tool, message: "Ready to confirm.", pending };
  }

  return { ok: false, tool, message: "Unknown tool.", pending };
}
