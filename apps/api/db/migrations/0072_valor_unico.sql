-- 0072: valor único. O Comandou cobra um preço só (plano "comandou", R$ 400,00 por mês), sem
-- cobrança por pessoa, produto ou pedido e sem limites. Em 0065 os planos antigos saíram da
-- página de preços, mas quem já assinava continuava pagando o plano dele. Agora todo mundo passa
-- para o valor único:
--
-- 1) O plano "comandou" volta a ser o único ativo e público, padrão dos novos restaurantes, com
--    R$ 400,00, tudo incluso e sem limite. Os outros ficam inativos (só como histórico).
-- 2) Em teste ou com cobrança combinada com o suporte (manual): passa para o valor único já. Quem
--    está em teste paga R$ 400,00 quando o teste vencer.
-- 3) Pagando outro plano pelo Asaas: a troca fica agendada e vale na próxima mensalidade (a fatura
--    do próximo período sai com R$ 400,00). O período já pago continua como está.
-- 4) Plano de R$ 0 (cortesia dada no painel) fica como está: não tem vencimento.
--
-- As mensalidades em aberto de um período que ainda não começou são refeitas com o valor novo
-- pelo ciclo de cobrança (BillingService.toSinglePrice), porque mexem no Asaas.
-- Só roda onde já existem planos; instalação nova recebe o plano único por default-plans.ts.

DO $$
DECLARE
  single uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plans) THEN
    RETURN;
  END IF;

  INSERT INTO plans (code, name, price_monthly, max_users, max_products, max_orders_month,
                     feature_fiscal, feature_whatsapp, feature_custom_domain, trial_days,
                     is_default, active, tagline, highlights, featured, show_public, sort_order)
  VALUES ('comandou', 'Comandou', 400.00, NULL, NULL, NULL, true, true, true, 7,
          false, true, 'Tudo do sistema por um valor fixo, sem cobrança por pedido',
          '["Sem limite de equipe, produtos e pedidos", "PDV, salão, cozinha, caixa e entregas", "Cardápio online próprio e WhatsApp", "Nota fiscal (NFC-e e NF-e)"]'::jsonb,
          true, true, 0)
  ON CONFLICT (code) DO NOTHING;

  UPDATE plans SET is_default = false WHERE code <> 'comandou' AND is_default;
  UPDATE plans SET price_monthly = 400.00, max_users = NULL, max_products = NULL,
         max_orders_month = NULL, feature_fiscal = true, feature_whatsapp = true,
         feature_custom_domain = true, is_default = true, active = true, show_public = true,
         featured = true
   WHERE code = 'comandou'
   RETURNING id INTO single;
  UPDATE plans SET active = false, show_public = false, featured = false WHERE code <> 'comandou';

  -- Em teste ou cobrança manual: valor único já.
  UPDATE subscriptions s SET plan_id = single, scheduled_plan_id = NULL, scheduled_at = NULL
    FROM plans p
   WHERE p.id = s.plan_id AND s.plan_id <> single AND s.status <> 'cancelled'
     AND p.price_monthly > 0
     AND (s.status = 'trialing' OR s.billing_mode = 'manual');

  -- Pagando outro plano: troca na próxima mensalidade.
  UPDATE subscriptions s SET scheduled_plan_id = single, scheduled_at = now()
    FROM plans p
   WHERE p.id = s.plan_id AND s.plan_id <> single AND s.status <> 'cancelled'
     AND p.price_monthly > 0
     AND s.scheduled_plan_id IS DISTINCT FROM single;
END $$;
