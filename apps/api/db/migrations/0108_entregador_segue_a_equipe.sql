-- 0108: Entregador com login segue a Equipe. Somente aditiva (só acerta dados).
--
-- O cadastro em Entregas (couriers.active) podia ser desativado à parte, e o entregador seguia
-- "ativo" na Equipe mas o app dizia "Entregador desativado" e ele não recebia pedido nenhum.
-- Agora, para quem entra com login, vale só a Equipe: aqui o cadastro passa a refletir o acesso.
UPDATE couriers c
   SET active = (m.status = 'active' AND m.role = 'driver')
  FROM memberships m
 WHERE m.tenant_id = c.tenant_id AND m.user_id = c.user_id
   AND c.active IS DISTINCT FROM (m.status = 'active' AND m.role = 'driver');
