-- 0128: Super Admin zera o uso de IA de um restaurante.
--
-- Pedido do dono: depois de trocar a chave do OpenRouter pela de verdade, queria começar a contar
-- do zero para testar com dados reais. O botão "Zerar uso" (Tokens de IA › restaurante) apaga as
-- linhas de ai_usage daquele restaurante; o que foi apagado (tokens, custo, usos) fica no
-- histórico do painel. Somente aditiva.

GRANT DELETE ON ai_usage TO comandou_platform;
