-- Extra columns used by the live app + public product image bucket

ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS agent_instructions TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS product_name TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public product images" ON storage.objects;
CREATE POLICY "Public product images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Service uploads product images" ON storage.objects;
CREATE POLICY "Service uploads product images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Service update product images" ON storage.objects;
CREATE POLICY "Service update product images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'product-images');
