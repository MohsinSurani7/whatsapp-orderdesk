-- Categories, sizes, wallet numbers, richer WhatsApp message types

ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sizes TEXT;

ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS easypaisa_number TEXT;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS jazzcash_number TEXT;

ALTER TABLE whatsapp_messages DROP CONSTRAINT IF EXISTS whatsapp_messages_message_type_check;
ALTER TABLE whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'document', 'template', 'audio', 'interactive', 'button'));
