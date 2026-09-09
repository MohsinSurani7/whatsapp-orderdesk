ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS agent_paused BOOLEAN DEFAULT FALSE;
