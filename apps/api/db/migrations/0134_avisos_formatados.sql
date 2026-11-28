-- 0134: avisos de pedido do WhatsApp com a formatação do WhatsApp.
--
-- Pedido do David (0.281): "essas duas mensagens podem ser melhor formatadas; a indentação e a
-- formatação, pra gente usar o que o WhatsApp tem". Os textos padrão ganham título em negrito com
-- o número do pedido, linha em branco e citação ("> ") no recado final. Quem ainda está com o texto
-- padrão antigo (ou o do restaurante de exemplo) passa para o novo; texto que o dono escreveu fica
-- como está. Somente dados e padrões de coluna.

ALTER TABLE tenant_messaging_settings ALTER COLUMN text_accepted SET DEFAULT E'✅ *Pedido #{pedido} confirmado!*\n\nOi, {cliente}! O {restaurante} já recebeu seu pedido e está preparando. 👨‍🍳';
ALTER TABLE tenant_messaging_settings ALTER COLUMN text_ready SET DEFAULT E'🛍️ *Pedido #{pedido} pronto!*\n\n{cliente}, já pode vir buscar no {restaurante}. Te esperamos! 😊';
ALTER TABLE tenant_messaging_settings ALTER COLUMN text_dispatched SET DEFAULT E'🛵 *Pedido #{pedido} saiu para entrega!*\n\n{cliente}, seu pedido está a caminho e chega em poucos minutos.';
ALTER TABLE tenant_messaging_settings ALTER COLUMN text_delivered SET DEFAULT E'🎉 *Pedido #{pedido} entregue!*\n\nObrigado por pedir no {restaurante}, {cliente}. Bom apetite! 😋';
ALTER TABLE tenant_messaging_settings ALTER COLUMN text_cancelled SET DEFAULT E'❌ *Pedido #{pedido} cancelado*\n\n{cliente}, seu pedido no {restaurante} foi cancelado.\n> Se tiver qualquer dúvida, é só responder esta mensagem.';

UPDATE tenant_messaging_settings SET text_accepted = E'✅ *Pedido #{pedido} confirmado!*\n\nOi, {cliente}! O {restaurante} já recebeu seu pedido e está preparando. 👨‍🍳' WHERE text_accepted IN (E'Olá, {cliente}! O {restaurante} aceitou seu pedido #{pedido} e já está preparando.');
UPDATE tenant_messaging_settings SET text_accepted = E'🔥 *Pedido #{pedido} na brasa!*\n\nOi, {cliente}! Recebemos seu pedido no {restaurante} e ele já foi para a chapa.' WHERE text_accepted = E'Oi, {cliente}! 🔥 Recebemos seu pedido #{pedido} no {restaurante} e ele já foi para a brasa.';
UPDATE tenant_messaging_settings SET text_ready = E'🛍️ *Pedido #{pedido} pronto!*\n\n{cliente}, já pode vir buscar no {restaurante}. Te esperamos! 😊' WHERE text_ready IN (E'Olá, {cliente}! Seu pedido #{pedido} no {restaurante} está pronto para retirada.');
UPDATE tenant_messaging_settings SET text_ready = E'🍔 *Pedido #{pedido} pronto!*\n\n{cliente}, pode retirar no balcão do {restaurante}. Bom apetite!' WHERE text_ready = E'Oi, {cliente}! Seu pedido #{pedido} está pronto para retirar no balcão do {restaurante}. Bom apetite!';
UPDATE tenant_messaging_settings SET text_dispatched = E'🛵 *Pedido #{pedido} saiu para entrega!*\n\n{cliente}, seu pedido está a caminho e chega em poucos minutos.' WHERE text_dispatched IN (E'Olá, {cliente}! Seu pedido #{pedido} do {restaurante} saiu para entrega.');
UPDATE tenant_messaging_settings SET text_dispatched = E'🛵 *Pedido #{pedido} saiu para entrega!*\n\n{cliente}, seu pedido está a caminho e chega quentinho em poucos minutos.' WHERE text_dispatched = E'{cliente}, seu pedido #{pedido} saiu para entrega! 🛵 Chega quentinho em poucos minutos.';
UPDATE tenant_messaging_settings SET text_delivered = E'🎉 *Pedido #{pedido} entregue!*\n\nObrigado por pedir no {restaurante}, {cliente}. Bom apetite! 😋' WHERE text_delivered IN (E'Pedido #{pedido} entregue. Obrigado por pedir no {restaurante}, {cliente}! Bom apetite.');
UPDATE tenant_messaging_settings SET text_delivered = E'🎉 *Pedido #{pedido} entregue!*\n\nValeu por pedir no {restaurante}, {cliente}! 🍔\n> Conta pra gente o que achou na loja online.' WHERE text_delivered = E'Pedido #{pedido} entregue! Valeu por pedir no {restaurante}, {cliente}. Conta pra gente o que achou na loja online. 🍔';
UPDATE tenant_messaging_settings SET text_cancelled = E'❌ *Pedido #{pedido} cancelado*\n\n{cliente}, seu pedido no {restaurante} foi cancelado.\n> Se tiver qualquer dúvida, é só responder esta mensagem.' WHERE text_cancelled IN (E'Olá, {cliente}. Seu pedido #{pedido} no {restaurante} foi cancelado. Se tiver dúvidas, responda esta mensagem.');
UPDATE tenant_messaging_settings SET text_cancelled = E'❌ *Pedido #{pedido} cancelado*\n\nOi, {cliente}. Seu pedido no {restaurante} foi cancelado.\n> Se tiver qualquer dúvida, é só responder esta mensagem.' WHERE text_cancelled = E'Oi, {cliente}. Seu pedido #{pedido} no {restaurante} foi cancelado. Se tiver qualquer dúvida, é só responder esta mensagem.';
