-- 0063: editar o pedido já lançado (quantidade e observação do item).
--
-- O preço unitário e o produto do item continuam fixos depois de criado; a edição do pedido muda
-- só a quantidade (com o total da linha refeito pelo mesmo preço) e a observação. Cada edição
-- fica na auditoria (order.edited). Somente privilégio, sem mudança de dados.

GRANT UPDATE (quantity, total, notes) ON order_items TO comandou_app;
