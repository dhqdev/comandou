-- 0046: via de entrega do pedido (vai com o motoboy). Somente troca de CHECK.
-- 1) print_jobs.kind ganha 'delivery_slip' (impressão sob demanda pelo painel do pedido).
-- 2) print_templates.kind ganha 'delivery_slip': o restaurante molda a via em Liquid.

ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_kind_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_kind_check
  CHECK (kind IN ('kitchen_ticket','receipt','test','fiscal_receipt','kitchen_cancel','delivery_slip'));

ALTER TABLE print_templates DROP CONSTRAINT IF EXISTS print_templates_kind_check;
ALTER TABLE print_templates ADD CONSTRAINT print_templates_kind_check
  CHECK (kind IN ('receipt','delivery_slip','kitchen_ticket','fiscal_footer'));
