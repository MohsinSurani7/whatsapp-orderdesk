import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import { isSupabaseEnabled, loadDbFromSupabase, saveDbToSupabase } from "@/lib/db/supabase-sync";

export interface LocalUser {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  created_at: string;
}

export interface LocalBusiness {
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
  default_order_status: string;
  default_payment_method: string;
  onboarding_completed: boolean;
  created_at: string;
}

export interface LocalMember {
  id: string;
  business_id: string;
  user_id: string;
  role: string;
}

export interface LocalCustomer {
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

export interface LocalProduct {
  id: string;
  business_id: string;
  name: string;
  sku: string | null;
  description: string | null;
  price: number;
  cost: number | null;
  stock: number | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface LocalOrder {
  id: string;
  business_id: string;
  order_number: string;
  customer_id: string;
  subtotal: number;
  discount: number;
  delivery_fee: number;
  tax: number;
  total: number;
  payment_method: string;
  payment_status: string;
  order_status: string;
  delivery_address: string | null;
  customer_note: string | null;
  internal_note: string | null;
  source: string;
  whatsapp_conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalOrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  variant: string | null;
}

export interface LocalConversation {
  id: string;
  business_id: string;
  customer_phone: string;
  customer_id: string | null;
  customer_name: string | null;
  status: string;
  pending_order_data: Record<string, unknown> | null;
  last_message_at: string;
  created_at: string;
}

export interface LocalMessage {
  id: string;
  business_id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  content: string;
  whatsapp_message_id: string | null;
  image_url: string | null;
  product_name?: string | null;
  created_at: string;
}

export interface LocalWhatsAppConfig {
  id: string;
  business_id: string;
  phone_number_id: string | null;
  waba_id: string | null;
  access_token: string | null;
  verify_token: string;
  agent_enabled: boolean;
  agent_name: string;
  agent_greeting: string;
  agent_instructions: string | null;
  groq_api_key: string | null;
  auto_confirm_orders: boolean;
}

export interface LocalTemplate {
  id: string;
  business_id: string;
  name: string;
  template_key: string;
  content: string;
}

export interface LocalSubscription {
  id: string;
  business_id: string;
  plan: string;
  status: string;
}

export interface LocalNotification {
  id: string;
  business_id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
}

export interface DatabaseShape {
  users: LocalUser[];
  businesses: LocalBusiness[];
  members: LocalMember[];
  customers: LocalCustomer[];
  products: LocalProduct[];
  orders: LocalOrder[];
  order_items: LocalOrderItem[];
  conversations: LocalConversation[];
  messages: LocalMessage[];
  whatsapp_configs: LocalWhatsAppConfig[];
  templates: LocalTemplate[];
  subscriptions: LocalSubscription[];
  notifications: LocalNotification[];
}

const emptyDb = (): DatabaseShape => ({
  users: [],
  businesses: [],
  members: [],
  customers: [],
  products: [],
  orders: [],
  order_items: [],
  conversations: [],
  messages: [],
  whatsapp_configs: [],
  templates: [],
  subscriptions: [],
  notifications: [],
});

function dbPath() {
  return path.join(process.cwd(), "data", "db.json");
}

export async function readDb(): Promise<DatabaseShape> {
  if (isSupabaseEnabled()) {
    return loadDbFromSupabase();
  }
  const file = dbPath();
  if (!fs.existsSync(file)) return emptyDb();
  try {
    return { ...emptyDb(), ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return emptyDb();
  }
}

export async function writeDb(db: DatabaseShape) {
  if (isSupabaseEnabled()) {
    await saveDbToSupabase(db);
    return;
  }
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(db, null, 2), "utf8");
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt, 32);
  const prev = Buffer.from(hash, "hex");
  return prev.length === next.length && timingSafeEqual(prev, next);
}

export function nowIso() {
  return new Date().toISOString();
}

export function uid() {
  return randomUUID();
}

export function defaultTemplates(businessId: string): LocalTemplate[] {
  return [
    {
      id: uid(),
      business_id: businessId,
      name: "Order Confirmation",
      template_key: "order_confirmation",
      content:
        "Hi {customer_name}, aap ka order #{order_number} confirm ho gaya hai. Total: {currency}{total}. Shukriya! - {business_name}",
    },
    {
      id: uid(),
      business_id: businessId,
      name: "Out for Delivery",
      template_key: "out_for_delivery",
      content: "Hi {customer_name}, aap ka order #{order_number} delivery ke liye nikal chuka hai.",
    },
    {
      id: uid(),
      business_id: businessId,
      name: "Delivered",
      template_key: "delivered",
      content: "Hi {customer_name}, aap ka order #{order_number} deliver ho gaya hai. Shukriya! - {business_name}",
    },
    {
      id: uid(),
      business_id: businessId,
      name: "Payment Reminder",
      template_key: "payment_reminder",
      content: "Hi {customer_name}, order #{order_number} ka payment {currency}{total} pending hai.",
    },
  ];
}

export function envWhatsAppDefaults() {
  return {
    phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    waba_id: process.env.WHATSAPP_WABA_ID || null,
    access_token: process.env.WHATSAPP_ACCESS_TOKEN || null,
    verify_token: process.env.WHATSAPP_VERIFY_TOKEN || null,
  };
}

export async function resolveWhatsAppConfig(phoneNumberId?: string | null) {
  const db = await readDb();
  if (!phoneNumberId) {
    return { config: null, business: null, db };
  }

  const match = db.whatsapp_configs.find((c) => c.phone_number_id && c.phone_number_id === phoneNumberId);
  if (!match) {
    return { config: null, business: null, db };
  }

  const business = db.businesses.find((b) => b.id === match.business_id) ?? null;
  return { config: match, business, db };
}
