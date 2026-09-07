-- WhatsApp OrderDesk - Initial Schema
-- Multi-tenant with RLS

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Businesses
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  business_type TEXT,
  country TEXT DEFAULT 'PK',
  currency TEXT DEFAULT 'PKR',
  timezone TEXT DEFAULT 'Asia/Karachi',
  phone TEXT,
  whatsapp_number TEXT,
  address TEXT,
  logo_url TEXT,
  invoice_prefix TEXT DEFAULT 'ORD',
  default_order_status TEXT DEFAULT 'pending',
  default_payment_method TEXT DEFAULT 'cod',
  onboarding_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Business members
CREATE TABLE business_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'staff')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, user_id)
);

-- WhatsApp configuration per business
CREATE TABLE whatsapp_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  phone_number_id TEXT,
  waba_id TEXT,
  access_token TEXT,
  verify_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  webhook_secret TEXT,
  agent_enabled BOOLEAN DEFAULT TRUE,
  agent_name TEXT DEFAULT 'Order Assistant',
  agent_greeting TEXT DEFAULT 'Assalam o Alaikum! Main aap ki order mein madad kar sakta hoon. Aap kya order karna chahte hain?',
  auto_confirm_orders BOOLEAN DEFAULT FALSE,
  business_hours_start TIME,
  business_hours_end TIME,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customers
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  notes TEXT,
  whatsapp_id TEXT,
  total_orders INT DEFAULT 0,
  total_spent NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, phone)
);

-- Products
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  description TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost NUMERIC(12,2),
  stock INT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- WhatsApp conversations
CREATE TABLE whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_phone TEXT NOT NULL,
  customer_id UUID REFERENCES customers(id),
  customer_name TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'awaiting_confirmation', 'closed', 'handed_off')),
  pending_order_data JSONB,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, customer_phone)
);

-- WhatsApp messages
CREATE TABLE whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'document', 'template')),
  content TEXT NOT NULL,
  whatsapp_message_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orders
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id),
  subtotal NUMERIC(12,2) DEFAULT 0,
  discount NUMERIC(12,2) DEFAULT 0,
  delivery_fee NUMERIC(12,2) DEFAULT 0,
  tax NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  payment_method TEXT DEFAULT 'cod',
  payment_status TEXT DEFAULT 'unpaid',
  order_status TEXT DEFAULT 'pending',
  delivery_address TEXT,
  customer_note TEXT,
  internal_note TEXT,
  source TEXT DEFAULT 'whatsapp',
  whatsapp_conversation_id UUID REFERENCES whatsapp_conversations(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, order_number)
);

-- Order items
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL,
  variant TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT,
  reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- WhatsApp message templates
CREATE TABLE whatsapp_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_key TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, template_key)
);

-- Subscriptions
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  plan TEXT DEFAULT 'starter' CHECK (plan IN ('starter', 'pro', 'business')),
  status TEXT DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  read BOOLEAN DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_customers_business ON customers(business_id);
CREATE INDEX idx_orders_business ON orders(business_id);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(business_id, order_status);
CREATE INDEX idx_products_business ON products(business_id);
CREATE INDEX idx_whatsapp_conversations_business ON whatsapp_conversations(business_id);
CREATE INDEX idx_whatsapp_messages_conversation ON whatsapp_messages(conversation_id);
CREATE INDEX idx_whatsapp_configs_phone ON whatsapp_configs(phone_number_id);

-- Helper: get user's business IDs
CREATE OR REPLACE FUNCTION get_user_business_ids()
RETURNS SETOF UUID AS $$
  SELECT business_id FROM business_members WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- RLS Policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Businesses
CREATE POLICY "Members can view their businesses" ON businesses FOR SELECT
  USING (id IN (SELECT get_user_business_ids()));
CREATE POLICY "Owners can update their businesses" ON businesses FOR UPDATE
  USING (id IN (SELECT business_id FROM business_members WHERE user_id = auth.uid() AND role = 'owner'));
CREATE POLICY "Authenticated users can create businesses" ON businesses FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Business members
CREATE POLICY "Members can view team" ON business_members FOR SELECT
  USING (business_id IN (SELECT get_user_business_ids()));
CREATE POLICY "Owners can manage team" ON business_members FOR ALL
  USING (business_id IN (SELECT business_id FROM business_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));

-- Tenant tables - standard pattern
CREATE POLICY "Tenant access" ON whatsapp_configs FOR ALL
  USING (business_id IN (SELECT get_user_business_ids()));
CREATE POLICY "Tenant access" ON customers FOR ALL
  USING (business_id IN (SELECT get_user_business_ids()));
CREATE POLICY "Tenant access" ON products FOR ALL
  USING (business_id IN (SELECT get_user_business_ids()));
CREATE POLICY "Tenant access" ON whatsapp_conversations FOR ALL
  USING (business_id IN (SELECT get_user_business_ids()));
CREATE POLICY "Tenant access" ON whatsapp_messages FOR ALL
  USING (business_id IN (SELECT get_user_business_ids()));
CREATE POLICY "Tenant access" ON orders FOR ALL
  USING (business_id IN (SELECT get_user_business_ids()));
CREATE POLICY "Tenant access" ON order_items FOR ALL
  USING (order_id IN (SELECT id FROM orders WHERE business_id IN (SELECT get_user_business_ids())));
CREATE POLICY "Tenant access" ON payments FOR ALL
  USING (business_id IN (SELECT get_user_business_ids()));
CREATE POLICY "Tenant access" ON whatsapp_templates FOR ALL
  USING (business_id IN (SELECT get_user_business_ids()));
CREATE POLICY "Tenant access" ON subscriptions FOR ALL
  USING (business_id IN (SELECT get_user_business_ids()));
CREATE POLICY "Tenant access" ON notifications FOR ALL
  USING (business_id IN (SELECT get_user_business_ids()));

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, email)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Default WhatsApp templates
CREATE OR REPLACE FUNCTION seed_whatsapp_templates(p_business_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO whatsapp_templates (business_id, name, template_key, content) VALUES
  (p_business_id, 'Order Confirmation', 'order_confirmation',
   'Hi {customer_name}, aap ka order #{order_number} confirm ho gaya hai. Total: {currency}{total}. Payment: {payment_status}. Shukriya! - {business_name}'),
  (p_business_id, 'Out for Delivery', 'out_for_delivery',
   'Hi {customer_name}, aap ka order #{order_number} delivery ke liye nikal chuka hai.'),
  (p_business_id, 'Delivered', 'delivered',
   'Hi {customer_name}, aap ka order #{order_number} deliver ho gaya hai. Dobara order karne ke liye shukriya! - {business_name}'),
  (p_business_id, 'Payment Reminder', 'payment_reminder',
   'Hi {customer_name}, order #{order_number} ka payment {currency}{total} abhi pending hai. Baraye meherbani jald clear kar dein.');
END;
$$ LANGUAGE plpgsql;
