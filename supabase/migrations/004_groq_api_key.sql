-- Per-shop Groq key so each buyer uses their own free Llama quota
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS groq_api_key TEXT;
