-- Production commerce: constraints, ledger, idempotency, order item snapshots

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_inbound_id
  ON whatsapp_messages (business_id, whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2);

UPDATE order_items
SET subtotal = ROUND(quantity * unit_price, 2)
WHERE subtotal IS NULL;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_stock_non_negative;
ALTER TABLE products ADD CONSTRAINT products_stock_non_negative CHECK (stock IS NULL OR stock >= 0);

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_qty_positive;
ALTER TABLE order_items ADD CONSTRAINT order_items_qty_positive CHECK (quantity > 0);

ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS last_order_idempotency TEXT;

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  variant_id TEXT,
  type TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  previous_stock NUMERIC(12,2),
  new_stock NUMERIC(12,2),
  actor_type TEXT,
  actor_id TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_txn_product ON inventory_transactions(business_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_txn_ref ON inventory_transactions(reference_type, reference_id);

ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant access" ON inventory_transactions;
CREATE POLICY "Tenant access" ON inventory_transactions FOR ALL
  USING (business_id IN (SELECT business_id FROM business_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (business_id, key)
);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant access" ON idempotency_keys;
CREATE POLICY "Tenant access" ON idempotency_keys FOR ALL
  USING (business_id IN (SELECT business_id FROM business_members WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(business_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(business_id, phone);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(business_id, sku);
