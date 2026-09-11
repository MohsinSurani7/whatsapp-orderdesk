-- SaaS AI control, delivery policy, aliases, WhatsApp connection extras.
-- Does not drop existing tables or data.

ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS groq_model TEXT;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS groq_temperature NUMERIC;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS groq_max_tokens INT;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS agent_language TEXT DEFAULT 'auto';
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS display_phone_number TEXT;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS verified_name TEXT;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS connection_status TEXT;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS last_webhook_at TIMESTAMPTZ;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS meta_business_id TEXT;

CREATE TABLE IF NOT EXISTS ai_instructions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  instruction TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  priority INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_instructions_biz ON ai_instructions(business_id, active);

CREATE TABLE IF NOT EXISTS delivery_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  enabled BOOLEAN DEFAULT TRUE,
  delivery_fee NUMERIC(12,2) DEFAULT 0,
  free_delivery_above NUMERIC(12,2),
  delivery_areas TEXT,
  estimated_delivery_time TEXT,
  delivery_policy TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_aliases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (business_id, product_id, alias)
);

CREATE TABLE IF NOT EXISTS ai_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind TEXT,
  model TEXT,
  latency_ms INT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_biz ON ai_logs(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  meta_business_id TEXT,
  waba_id TEXT,
  phone_number_id TEXT,
  display_phone_number TEXT,
  verified_name TEXT,
  access_token_encrypted TEXT,
  token_type TEXT,
  status TEXT DEFAULT 'disconnected',
  webhook_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_conn_phone
  ON whatsapp_connections (phone_number_id)
  WHERE phone_number_id IS NOT NULL;

ALTER TABLE ai_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant access" ON ai_instructions;
CREATE POLICY "Tenant access" ON ai_instructions FOR ALL
  USING (business_id IN (SELECT business_id FROM business_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Tenant access" ON delivery_settings;
CREATE POLICY "Tenant access" ON delivery_settings FOR ALL
  USING (business_id IN (SELECT business_id FROM business_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Tenant access" ON product_aliases;
CREATE POLICY "Tenant access" ON product_aliases FOR ALL
  USING (business_id IN (SELECT business_id FROM business_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Tenant access" ON ai_logs;
CREATE POLICY "Tenant access" ON ai_logs FOR ALL
  USING (business_id IN (SELECT business_id FROM business_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Tenant access" ON whatsapp_connections;
CREATE POLICY "Tenant access" ON whatsapp_connections FOR ALL
  USING (business_id IN (SELECT business_id FROM business_members WHERE user_id = auth.uid()));
