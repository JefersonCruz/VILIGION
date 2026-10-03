-- Schema do vínculo telefone↔endereço. O dado real (telefone+endereço) NUNCA
-- fica em coluna legível - só em `ciphertext`, junto dos materiais necessários
-- pra decriptar via KMS (ver encryption.ts). Isto é o schema público; os
-- valores reais que entram nestas colunas são sempre criptografados.

CREATE TABLE phone_mappings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- hash do endereço (não o endereço em claro) só pra permitir lookup/índice
    -- sem expor o dado em texto puro na própria estrutura do índice
    address_hash        TEXT NOT NULL UNIQUE,
    encrypted_data_key  BYTEA NOT NULL,
    iv                  BYTEA NOT NULL,
    auth_tag            BYTEA NOT NULL,
    ciphertext          BYTEA NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_phone_mappings_address_hash ON phone_mappings (address_hash);

-- Limiares de detecção por usuário - PRIVADO, nunca versionado no código
-- público (ver engine/rules/detection-rules.ts e ARCHITECTURE.md). Par de
-- colunas "critical_*" decide o CANAL (ligação vs e-mail, ver
-- alerts/email-notifier.ts e alerts/twilio-voice.ts) - abaixo do limiar
-- crítico mas acima do normal, o alerta sai por e-mail.
CREATE TABLE user_thresholds (
    user_id                            UUID PRIMARY KEY REFERENCES phone_mappings (id),
    max_balance_drop_pct               NUMERIC NOT NULL,
    critical_balance_drop_pct          NUMERIC NOT NULL,
    window_minutes                     INTEGER NOT NULL,
    blocked_transfer_alert_threshold   NUMERIC NOT NULL,
    critical_blocked_transfer_threshold NUMERIC NOT NULL
);

-- Log de alertas disparados - útil pra auditoria e pra detectar TDoS
-- (muitos alertas num intervalo curto pro mesmo usuário é sinal de ataque
-- coordenado, não só de muita sorte ruim - ver SECURITY.md).
CREATE TABLE alert_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id    TEXT NOT NULL UNIQUE,
    user_id     UUID NOT NULL REFERENCES phone_mappings (id),
    kind        TEXT NOT NULL,
    severity      TEXT NOT NULL, -- 'normal' | 'critical' - decide delivered_via (ver detection-rules.ts)
    delivered_via TEXT NOT NULL, -- 'voice' | 'email'
    pin_status  TEXT, -- 'valid' | 'invalid' | 'expired' | 'already-consumed' | NULL (sem resposta, ou N/A pra e-mail)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
