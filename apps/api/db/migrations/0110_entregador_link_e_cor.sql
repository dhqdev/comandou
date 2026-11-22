-- 0110: link do entregador que dá para copiar de novo e cor escolhida do entregador. Somente aditiva.
--
-- access_token_enc: o mesmo token do link, cifrado com a INTEGRATIONS_KEY (AES-256-GCM, contexto
--                   restaurante + entregador). Só quem gerencia entregas o lê, pelo botão Copiar
--                   link. O login pelo link continua pelo hash (access_token_hash). Links gerados
--                   antes desta versão não têm cópia: o primeiro Copiar link gera um novo.
-- color:            cor do entregador no mapa e no calendário de pagamento (NULL = a automática).
ALTER TABLE couriers
  ADD COLUMN access_token_enc bytea,
  ADD COLUMN color text CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$');
