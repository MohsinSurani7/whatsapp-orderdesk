import type {
  DatabaseShape,
  LocalBusiness,
  LocalConversation,
  LocalCustomer,
  LocalMember,
  LocalMessage,
  LocalNotification,
  LocalOrder,
  LocalOrderItem,
  LocalProduct,
  LocalSubscription,
  LocalTemplate,
  LocalUser,
  LocalWhatsAppConfig,
} from "@/lib/db/store";
import { createAdminClient } from "@/lib/supabase/admin";

export function isSupabaseEnabled() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return (
    url.startsWith("https://") &&
    url.includes("supabase.co") &&
    key.length > 40 &&
    !/your-|placeholder|example/i.test(url + key)
  );
}

function num(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

export async function loadDbFromSupabase(): Promise<DatabaseShape> {
  const sb = createAdminClient();
  const [
    profiles,
    businesses,
    members,
    customers,
    products,
    orders,
    items,
    conversations,
    messages,
    configs,
    templates,
    subscriptions,
    notifications,
    inventoryTx,
    idemKeys,
  ] = await Promise.all([
    sb.from("profiles").select("*"),
    sb.from("businesses").select("*"),
    sb.from("business_members").select("*"),
    sb.from("customers").select("*"),
    sb.from("products").select("*"),
    sb.from("orders").select("*"),
    sb.from("order_items").select("*"),
    sb.from("whatsapp_conversations").select("*"),
    sb.from("whatsapp_messages").select("*"),
    sb.from("whatsapp_configs").select("*"),
    sb.from("whatsapp_templates").select("*"),
    sb.from("subscriptions").select("*"),
    sb.from("notifications").select("*"),
    sb.from("inventory_transactions").select("*"),
    sb.from("idempotency_keys").select("*"),
  ]);

  const firstError = [
    profiles,
    businesses,
    members,
    customers,
    products,
    orders,
    items,
    conversations,
    messages,
    configs,
    templates,
    subscriptions,
    notifications,
    inventoryTx,
    idemKeys,
  ].find((r) => r.error && !/schema cache|does not exist|Could not find the table/i.test(r.error.message));
  if (firstError?.error) {
    throw new Error(`Supabase load failed: ${firstError.error.message}`);
  }

  const users: LocalUser[] = (profiles.data || []).map((p) => ({
    id: p.id,
    email: p.email || "",
    full_name: p.full_name || "",
    password_hash: "",
    created_at: p.created_at,
  }));

  return {
    users,
    businesses: (businesses.data || []) as LocalBusiness[],
    members: (members.data || []).map((m) => ({
      id: m.id,
      business_id: m.business_id,
      user_id: m.user_id,
      role: m.role,
    })) as LocalMember[],
    customers: (customers.data || []).map((c) => ({
      ...c,
      total_orders: num(c.total_orders),
      total_spent: num(c.total_spent),
    })) as LocalCustomer[],
    products: (products.data || []).map((p) => ({
      ...p,
      price: num(p.price),
      cost: p.cost == null ? null : num(p.cost),
      image_url: p.image_url ?? null,
      category: p.category ?? null,
      sizes: p.sizes ?? null,
    })) as LocalProduct[],
    orders: (orders.data || []).map((o) => ({
      ...o,
      subtotal: num(o.subtotal),
      discount: num(o.discount),
      delivery_fee: num(o.delivery_fee),
      tax: num(o.tax),
      total: num(o.total),
    })) as LocalOrder[],
    order_items: (items.data || []).map((i) => ({
      ...i,
      quantity: num(i.quantity, 1),
      unit_price: num(i.unit_price),
    })) as LocalOrderItem[],
    conversations: (conversations.data || []).map((c) => ({
      ...c,
      agent_paused: Boolean(c.agent_paused),
    })) as LocalConversation[],
    messages: (messages.data || []).map((m) => ({
      id: m.id,
      business_id: m.business_id,
      conversation_id: m.conversation_id,
      direction: m.direction,
      message_type: m.message_type,
      content: m.content,
      whatsapp_message_id: m.whatsapp_message_id,
      image_url: m.image_url ?? m.metadata?.image_url ?? null,
      product_name: m.product_name ?? m.metadata?.product_name ?? null,
      created_at: m.created_at,
    })) as LocalMessage[],
    whatsapp_configs: (configs.data || []).map((c) => ({
      ...c,
      agent_instructions: c.agent_instructions ?? null,
      groq_api_key: c.groq_api_key ?? null,
    })) as LocalWhatsAppConfig[],
    templates: (templates.data || []) as LocalTemplate[],
    subscriptions: (subscriptions.data || []) as LocalSubscription[],
    notifications: (notifications.data || []) as LocalNotification[],
    inventory_transactions: inventoryTx.error ? [] : (inventoryTx.data || []),
    idempotency_keys: idemKeys.error ? [] : (idemKeys.data || []),
  };
}

async function upsertTable(table: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const sb = createAdminClient();
  const { error } = await sb.from(table).upsert(rows);
  if (error) throw new Error(`${table} upsert: ${error.message}`);
}

async function pruneTable(table: string, rows: Array<Record<string, unknown>>, idKey = "id") {
  const sb = createAdminClient();
  const { data: existing, error: readErr } = await sb.from(table).select("id");
  if (readErr) throw new Error(`${table} read: ${readErr.message}`);
  const keep = new Set(rows.map((r) => String(r[idKey])));
  const extra = (existing || [])
    .map((r) => String((r as unknown as { id: string }).id))
    .filter((id) => id && !keep.has(id));
  if (!extra.length) return;
  const { error } = await sb.from(table).delete().in(idKey, extra);
  if (error) throw new Error(`${table} delete: ${error.message}`);
}

export async function saveDbToSupabase(db: DatabaseShape) {
  const businesses = db.businesses.map((b) => ({ ...b }));
  const members = db.members.map((m) => ({
    id: m.id,
    business_id: m.business_id,
    user_id: m.user_id,
    role: m.role,
  }));
  const customers = db.customers.map((c) => ({ ...c }));
  const products = db.products.map((p) => ({ ...p }));
  const configs = db.whatsapp_configs.map((c) => ({
    id: c.id,
    business_id: c.business_id,
    phone_number_id: c.phone_number_id,
    waba_id: c.waba_id,
    access_token: c.access_token,
    verify_token: c.verify_token,
    agent_enabled: c.agent_enabled,
    agent_name: c.agent_name,
    agent_greeting: c.agent_greeting,
    agent_instructions: c.agent_instructions,
    groq_api_key: c.groq_api_key ?? null,
    easypaisa_number: c.easypaisa_number ?? null,
    jazzcash_number: c.jazzcash_number ?? null,
    auto_confirm_orders: c.auto_confirm_orders,
  }));
  const conversations = db.conversations.map((c) => ({ ...c }));
  const messages = db.messages.map((m) => ({
    id: m.id,
    business_id: m.business_id,
    conversation_id: m.conversation_id,
    direction: m.direction,
    message_type: m.message_type,
    content: m.content,
    whatsapp_message_id: m.whatsapp_message_id,
    image_url: m.image_url,
    product_name: m.product_name ?? null,
    created_at: m.created_at,
  }));
  const orders = db.orders.map((o) => ({ ...o }));
  const items = db.order_items.map((i) => ({ ...i }));
  const templates = db.templates.map((t) => ({
    id: t.id,
    business_id: t.business_id,
    name: t.name,
    template_key: t.template_key,
    content: t.content,
    is_active: true,
  }));
  const subscriptions = db.subscriptions.map((s) => ({
    id: s.id,
    business_id: s.business_id,
    plan: ["starter", "pro", "business"].includes(s.plan) ? s.plan : "starter",
    status: ["trialing", "active", "past_due", "cancelled", "expired"].includes(s.status)
      ? s.status
      : "trialing",
  }));
  const notifications = db.notifications.map((n) => ({
    id: n.id,
    business_id: n.business_id,
    title: n.title,
    message: n.message,
    type: n.type,
    read: n.read,
    created_at: n.created_at,
  }));

  await upsertTable("businesses", businesses);
  await upsertTable("business_members", members);
  await upsertTable("customers", customers);
  await upsertTable("products", products);
  await upsertTable("whatsapp_configs", configs);
  await upsertTable("whatsapp_conversations", conversations);
  await upsertTable("whatsapp_messages", messages);
  await upsertTable("orders", orders);
  await upsertTable("order_items", items);
  await upsertTable("whatsapp_templates", templates);
  await upsertTable("subscriptions", subscriptions);
  await upsertTable("notifications", notifications);
  try {
    await upsertTable("inventory_transactions", (db.inventory_transactions || []) as unknown as Array<Record<string, unknown>>);
    await upsertTable("idempotency_keys", (db.idempotency_keys || []) as unknown as Array<Record<string, unknown>>);
  } catch (err) {
    console.error("Optional commerce tables upsert skipped:", err);
  }

  await pruneTable("whatsapp_messages", messages);
  await pruneTable("order_items", items);
  await pruneTable("orders", orders);
  await pruneTable("whatsapp_conversations", conversations);
  await pruneTable("whatsapp_templates", templates);
  await pruneTable("notifications", notifications);
  await pruneTable("subscriptions", subscriptions);
  await pruneTable("whatsapp_configs", configs);
  await pruneTable("products", products);
  await pruneTable("customers", customers);
  await pruneTable("business_members", members);
}

export async function uploadProductImage(filename: string, bytes: Buffer, contentType: string) {
  const sb = createAdminClient();
  const path = `products/${filename}`;
  const { error } = await sb.storage.from("product-images").upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  const { data } = sb.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadChatMedia(filename: string, bytes: Buffer, contentType: string) {
  if (isSupabaseEnabled()) {
    const sb = createAdminClient();
    const path = `chat/${filename}`;
    const { error } = await sb.storage.from("product-images").upload(path, bytes, {
      contentType,
      upsert: true,
    });
    if (error) throw error;
    const { data } = sb.storage.from("product-images").getPublicUrl(path);
    return data.publicUrl;
  }
  const fs = await import("fs");
  const pathMod = await import("path");
  const dir = pathMod.join(process.cwd(), "public", "uploads", "chat");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pathMod.join(dir, filename), bytes);
  return `/uploads/chat/${filename}`;
}
