# 0014 — Custo automático das fichas técnicas

**Situação:** aceita (2026-11-17)

## Contexto

O dono do restaurante quer que, ao mudar o valor de uma matéria-prima que ele compra, o custo de
todos os itens que a usam seja recalculado sozinho. O custo de um item do cardápio já era lido na
hora (soma de quantidade × custo médio de cada insumo da ficha técnica), mas o **preparo da casa**
(molho, massa…) só mudava de custo quando era produzido de novo: o tomate subia e o molho, e tudo
que leva molho, continuava com o custo velho. Também não havia como trocar o preço sem lançar uma
compra, nem saber o que uma mudança de custo causou na margem.

Sistemas de ficha técnica costumam oferecer dois custos: o **custo médio** (contábil, usado no
CMV) e o **custo de reposição** (o último preço pago, usado para formar preço). Manter dois custos
paralelos dobraria as telas e as dúvidas do cliente.

## Decisão

- **Um custo só por insumo** (`avg_cost`), que continua sendo o custo médio ponderado nas
  compras. Para quem quer usar o preço novo na hora, o botão **Mudar preço** troca o custo pelo
  valor informado (com simulação do impacto antes de aplicar). O último custo de entrada fica em
  `last_cost` só para consulta.
- **Cascata no banco**: gatilho `AFTER UPDATE OF avg_cost` em `stock_items` recalcula os preparos
  que levam o insumo (`stock_prep_cost`: soma da ficha de preparo ÷ rendimento). O UPDATE dispara o
  gatilho de novo para o preparo, então preparo dentro de preparo também muda. Vale para qualquer
  caminho (entrada, recebimento, produção, demonstração), sem depender de lembrar de chamar código.
  A tela recusa ficha circular e o gatilho para em 16 níveis.
- **Cardápio continua lido na hora**: nada de custo copiado no produto que possa ficar velho.
- **Histórico com impacto** (`stock_cost_changes`): o serviço `StockCostsService` fotografa os
  custos antes (travando os insumos atingidos em ordem de id, como o resto do estoque) e depois,
  e grava insumos e itens do cardápio que mudaram, com o preço de venda. Compra que encarece manda
  aviso a gerentes e administradores. O preço de venda **nunca** muda sozinho.
- Preparo não aceita preço manual: o custo dele é sempre o da ficha de preparo.

## Consequências

- O custo do preparo passa a ser o de reposição pela ficha, não mais a média do que foi produzido.
  O CMV realizado não muda, porque cada baixa guarda o custo do momento no movimento.
- Uma compra com preço trava também os preparos que levam o insumo durante a transação.
- O assistente de IA recebe as últimas mudanças de custo e os itens com custo mais alto no preço.
