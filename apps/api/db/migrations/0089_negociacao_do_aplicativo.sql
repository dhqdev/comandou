-- 0089: Negociação com o cliente do aplicativo de delivery (ADR 0015, Fase 3). Somente aditiva.
--
-- channel_disputes: cada pedido do cliente feito pelo aplicativo depois do pedido (cancelar,
-- cancelar parte, reembolso, mais tempo) que o restaurante precisa responder antes do prazo.
-- O iFood recomenda NÃO responder sozinho: a resposta é sempre de uma pessoa, pela tela.
-- Guarda só o necessário para responder: a mensagem do cliente, as alternativas e os motivos
-- (sem fotos nem dados do cliente). A resposta sai pela caixa de saída (integration_outbox).

CREATE TABLE channel_disputes (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  order_id        uuid NOT NULL,
  channel         text NOT NULL CHECK (channel ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  -- Id da negociação no canal (iFood: disputeId).
  external_id     text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 100),
  -- O que o cliente pede: CANCELLATION, PARTIAL_CANCELLATION, PROPOSED_AMOUNT_REFUND...
  kind            text NOT NULL CHECK (kind ~ '^[A-Z][A-Z_]{1,60}$'),
  message         text CHECK (length(message) <= 1000),
  expires_at      timestamptz,
  -- O que o canal faz se ninguém responder (ACCEPT_CANCELLATION, REJECT_CANCELLATION...).
  timeout_action  text CHECK (timeout_action ~ '^[A-Z][A-Z_]{1,60}$'),
  -- Alternativas que o restaurante pode propor (reembolso, benefício, mais tempo) e os motivos.
  alternatives    jsonb NOT NULL DEFAULT '[]',
  accept_reasons  jsonb NOT NULL DEFAULT '[]',
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','accepted','rejected','alternative','settled')),
  decision        jsonb,
  decided_by      uuid,
  decided_at      timestamptz,
  -- Resultado final do canal (HANDSHAKE_SETTLEMENT): aceito, recusado, alternativa, expirou...
  outcome         text CHECK (outcome ~ '^[A-Z][A-Z_]{1,60}$'),
  settled_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, channel, external_id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX channel_disputes_order_idx ON channel_disputes(tenant_id, order_id, created_at DESC);
CREATE INDEX channel_disputes_open_idx ON channel_disputes(tenant_id, expires_at) WHERE status = 'open';

ALTER TABLE channel_disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON channel_disputes
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT ON channel_disputes TO comandou_app;
GRANT UPDATE (status, decision, decided_by, decided_at, outcome, settled_at, message, expires_at,
              timeout_action, alternatives, accept_reasons)
  ON channel_disputes TO comandou_app;
