-- 0074: página do restaurante (landing page em <endereço>/site).
--
-- tenant_store_settings.site: os textos da página (título, frase, sobre, destaques e o botão),
-- criados pela IA nos primeiros passos e editáveis em Loja online. NULL: página ainda não criada.
-- Logo, capa, cores, endereço, horário e itens vêm do cadastro da loja na hora de mostrar.
-- Somente aditiva.

ALTER TABLE tenant_store_settings
  ADD COLUMN site jsonb,
  ADD COLUMN site_updated_at timestamptz;
