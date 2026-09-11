export type BusinessRole = "owner" | "admin" | "staff";

export type OrderStatus =
  | "draft"
  | "pending"
  | "confirmed"
  | "processing"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "returned";

export type PaymentStatus = "unpaid" | "partially_paid" | "paid" | "refunded";

export type PaymentMethod =
  | "cash"
  | "cod"
  | "bank_transfer"
  | "card"
  | "easypaisa"
  | "jazzcash"
  | "other";

export type OrderSource =
  | "whatsapp"
  | "instagram"
  | "facebook"
  | "phone"
  | "walk_in"
  | "website"
  | "other";

export type AgentIntent =
  | "greeting"
  | "place_order"
  | "confirm_order"
  | "cancel_order"
  | "order_status"
  | "product_inquiry"
  | "payment_inquiry"
  | "delivery_inquiry"
  | "general"
  | "human_handoff";

export interface Business {
  id: string;
  name: string;
  business_type: string | null;
  country: string;
  currency: string;
  timezone: string;
  phone: string | null;
  whatsapp_number: string | null;
  address: string | null;
  logo_url: string | null;
  invoice_prefix: string;
  default_order_status: OrderStatus;
  default_payment_method: PaymentMethod;
  onboarding_completed: boolean;
  created_at: string;
}

export interface WhatsAppConfig {
  id: string;
  business_id: string;
  phone_number_id: string | null;
  waba_id: string | null;
  access_token: string | null;
  verify_token: string;
  webhook_secret: string | null;
  agent_enabled: boolean;
  agent_name: string;
  agent_greeting: string;
  auto_confirm_orders: boolean;
  business_hours_start: string | null;
  business_hours_end: string | null;
  created_at: string;
}

export interface Customer {
  id: string;
  business_id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  whatsapp_id: string | null;
  total_orders: number;
  total_spent: number;
  created_at: string;
}

export interface Product {
  id: string;
  business_id: string;
  name: string;
  sku: string | null;
  description: string | null;
  price: number;
  cost: number | null;
  stock: number | null;
  category: string | null;
  sizes: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Order {
  id: string;
  business_id: string;
  order_number: string;
  customer_id: string;
  subtotal: number;
  discount: number;
  delivery_fee: number;
  tax: number;
  total: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  order_status: OrderStatus;
  delivery_address: string | null;
  customer_note: string | null;
  internal_note: string | null;
  source: OrderSource;
  whatsapp_conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppConversation {
  id: string;
  business_id: string;
  customer_phone: string;
  customer_id: string | null;
  customer_name: string | null;
  status: "active" | "awaiting_confirmation" | "closed" | "handed_off";
  pending_order_data: Record<string, unknown> | null;
  agent_paused?: boolean;
  last_order_idempotency?: string | null;
  last_message_at: string;
  created_at: string;
}

export interface WhatsAppMessage {
  id: string;
  business_id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  message_type: "text" | "image" | "document" | "template" | "audio" | "interactive" | "video";
  content: string;
  whatsapp_message_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ParsedOrderData {
  customer_name: string | null;
  phone: string | null;
  address: string | null;
  products: Array<{
    product_id?: string | null;
    sku?: string | null;
    name: string;
    quantity: number;
    variant: string | null;
    unit_price: number | null;
  }>;
  subtotal: number | null;
  delivery_fee: number | null;
  discount: number | null;
  total: number | null;
  payment_method: PaymentMethod | null;
  payment_status: PaymentStatus | null;
  notes: string | null;
  session_phase?: string | null;
  pending_product_id?: string | null;
  pending_action?: string | null;
  catalog_index?: Array<{ n: number; id: string; name: string }>;
}

export type AgentAction =
  | "none"
  | "search_products"
  | "show_product"
  | "show_product_images"
  | "show_catalog"
  | "check_stock"
  | "add_to_cart"
  | "remove_from_cart"
  | "update_cart_item"
  | "clear_cart"
  | "view_cart"
  | "start_checkout"
  | "collect_customer_info"
  | "calculate_total"
  | "confirm_order"
  | "create_order"
  | "get_order_status"
  | "cancel_order"
  | "modify_order"
  | "request_human";

export interface AgentResponse {
  intent: AgentIntent;
  reply: string;
  parsed_order: ParsedOrderData | null;
  should_create_order: boolean;
  order_id: string | null;
  confidence: number;
  needs_human: boolean;
  action?: AgentAction;
  send_images?: Array<{
    path: string;
    caption: string;
    productName?: string;
    productId?: string;
    seeMore?: boolean;
  }>;
  quick_replies?: Array<{ id: string; title: string }>;
  list_menu?: {
    body: string;
    button: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  };
  skip_media?: boolean;
}
