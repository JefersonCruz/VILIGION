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

-- Credenciais de login do painel - chave primária é O MESMO UUID de
-- phone_mappings.id (unifica a identidade: quem prova posse do endereço no
-- cadastro é a mesma pessoa que loga no painel depois). Criado junto com a
-- linha de phone_mappings, numa única transação de cadastro - ver
-- privacy/signup-service.ts. Nunca guarda senha em claro (hashPassword já
-- usa scrypt, ver dashboard/password.ts).
CREATE TABLE dashboard_users (
    user_id       UUID PRIMARY KEY REFERENCES phone_mappings (id),
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    totp_secret   TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- Contas monitoradas por usuário - permite escolher QUALQUER chain
-- EVM-compatível conhecida (ver engine/chains/known-chains.ts) e QUALQUER
-- token ERC-20/TIP-20 nela, em vez de fixo em variável de ambiente. Um
-- usuário pode ter mais de uma conta monitorada (ex: tesouraria na Tempo E
-- um endereço na Base). Escopo deliberadamente limitado a chains
-- EVM-compatíveis - ver ARCHITECTURE.md sobre por que não-EVM e exchanges
-- centralizadas ficam fora por enquanto (risco de custódia de credencial,
-- adaptador do zero por chain, dilui o diferencial do produto).
CREATE TABLE monitored_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES phone_mappings (id),
    -- chave da chain em known-chains.ts (ex: "tempo", "base") - não o
    -- chain_id numérico diretamente, pra reusar a validação/registro já
    -- existente em getKnownChain()
    chain_key       TEXT NOT NULL,
    -- endereço do contrato do token (ERC-20/TIP-20) a monitorar via
    -- balanceOf - ver EvmAdapterConfig.tokenAddress
    token_address   TEXT NOT NULL,
    -- endereço (carteira/tesouraria) cujo saldo desse token é observado
    watched_address TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, chain_key, token_address, watched_address)
);

CREATE INDEX idx_monitored_accounts_user ON monitored_accounts (user_id);

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

-- Destinatários de alerta cadastrados pelo próprio usuário no painel
-- (/recipients) - fecha a lacuna que estava documentada em ARCHITECTURE.md e
-- docs/UI-SPEC.md: antes, os números/e-mails vinham só de env var
-- compartilhada (DEMO_ALERT_NUMBERS/DEMO_ALERT_EMAILS), igual pra todo
-- usuário. `kind` decide o dispatcher (voice vs email, ver
-- index.ts#makeDispatcher): 'phone' recebe ligação em alerta crítico,
-- 'email' recebe alerta normal.
--
-- O destino (telefone/e-mail) é criptografado com o MESMO esquema de
-- phone_mappings (encryption.ts), não guardado em texto puro - achado da
-- auditoria de 2026-10-03: um leak desta tabela, feito JOIN com
-- monitored_accounts por user_id, revelaria exatamente o vínculo
-- "este telefone recebe alerta sobre este endereço on-chain" que a
-- criptografia do cadastro existe pra evitar (ver SECURITY.md, linha sobre
-- wrench attack). Sem UNIQUE por valor em claro - como cada criptografia usa
-- IV/DEK novos, duplicar o mesmo destino não é detectável no banco; aceito
-- (o próprio usuário vê e remove duplicata na tela /recipients).
CREATE TABLE alert_recipients (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES phone_mappings (id),
    kind                TEXT NOT NULL CHECK (kind IN ('phone', 'email')),
    encrypted_data_key  BYTEA NOT NULL,
    iv                  BYTEA NOT NULL,
    auth_tag            BYTEA NOT NULL,
    ciphertext          BYTEA NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_recipients_user ON alert_recipients (user_id);
