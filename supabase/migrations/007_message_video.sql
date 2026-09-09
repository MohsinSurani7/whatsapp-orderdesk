ALTER TABLE whatsapp_messages DROP CONSTRAINT IF EXISTS whatsapp_messages_message_type_check;

ALTER TABLE whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'document', 'template', 'audio', 'interactive', 'button', 'video'));
