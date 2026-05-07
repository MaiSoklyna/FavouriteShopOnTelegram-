-- ============================================================
-- 009: AI Assistant (ChatGPT-powered customer support)
-- ============================================================

-- AI conversation sessions
CREATE TABLE IF NOT EXISTS ai_conversations (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) DEFAULT 'New Chat',
    status VARCHAR(20) DEFAULT 'active',  -- active, archived
    message_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual AI messages
CREATE TABLE IF NOT EXISTS ai_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,  -- 'user' or 'assistant'
    content TEXT NOT NULL,
    tokens_used INT,
    product_ids JSONB,  -- array of product IDs referenced in recommendations
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI settings (global for now)
CREATE TABLE IF NOT EXISTS ai_settings (
    id SERIAL PRIMARY KEY,
    is_enabled BOOLEAN DEFAULT TRUE,
    system_prompt TEXT,
    welcome_message TEXT DEFAULT 'Hi! I''m your shopping assistant. I can help you find products, answer questions about orders, and more. How can I help you today?',
    model VARCHAR(50) DEFAULT 'gpt-4o-mini',
    temperature DECIMAL(3,2) DEFAULT 0.7,
    max_tokens INT DEFAULT 500,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO ai_settings (is_enabled, system_prompt, welcome_message)
VALUES (TRUE, NULL, 'Hi! I''m your shopping assistant. I can help you find products, answer questions about orders, and more. How can I help you today?')
ON CONFLICT DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id);

-- Updated_at triggers
CREATE OR REPLACE FUNCTION update_ai_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_conversations_updated_at ON ai_conversations;
CREATE TRIGGER ai_conversations_updated_at
    BEFORE UPDATE ON ai_conversations
    FOR EACH ROW EXECUTE FUNCTION update_ai_updated_at();

DROP TRIGGER IF EXISTS ai_settings_updated_at ON ai_settings;
CREATE TRIGGER ai_settings_updated_at
    BEFORE UPDATE ON ai_settings
    FOR EACH ROW EXECUTE FUNCTION update_ai_updated_at();
