/**
 * Disponibilidade pela ficha técnica: um item do cardápio deixa de vender quando algum insumo
 * da ficha não dá para mais uma unidade. Insumo que pode ficar negativo nunca trava a venda.
 * Item vendido por peso (ficha por kg) só trava quando o insumo zera.
 *
 * Complemento com ficha (bacon extra, sabor de pizza) segue a mesma regra: sem estoque, a opção
 * aparece como sem estoque no PDV, no garçom e no cardápio online e o pedido com ela é recusado.
 * Item com grupo obrigatório que não fecha por falta de estoque (pizza de 2 sabores com só 1 sabor
 * com estoque) fica sem estoque inteiro.
 */

/** Condição de "falta" de uma linha da ficha (r = product_recipes, s = stock_items, p = products). */
export const RECIPE_LINE_SHORT = `(NOT s.allow_negative AND
  CASE WHEN p.sold_by_weight THEN s.quantity <= 0 ELSE s.quantity < r.quantity END)`;

/** Condição de "falta" de uma linha da ficha de um complemento (r = option_recipes, s = stock_items). */
export const OPTION_LINE_SHORT = `(NOT s.allow_negative AND s.quantity < r.quantity)`;

/** true quando o complemento `o` não dá para mais uma unidade do item (algum insumo acabou). */
export const OPTION_STOCK_OUT = `EXISTS (
  SELECT 1 FROM option_recipes r JOIN stock_items s ON s.id = r.stock_item_id
   WHERE r.option_id = o.id AND ${OPTION_LINE_SHORT})`;

/** Nomes dos insumos que faltam para o complemento `o` (vazio quando dá para vender). */
export const OPTION_STOCK_MISSING = `ARRAY(
  SELECT s.name FROM option_recipes r JOIN stock_items s ON s.id = r.stock_item_id
   WHERE r.option_id = o.id AND ${OPTION_LINE_SHORT} ORDER BY s.name)`;

/**
 * Grupo obrigatório do produto `p` que não fecha por falta de estoque: as opções ativas dariam a
 * escolha mínima, mas as que têm estoque não. Grupo que deixa repetir fecha com uma opção só.
 * Grupo sem opções ativas suficientes não conta: aí o problema é o cadastro, não o estoque.
 */
const REQUIRED_GROUP_SHORT = `EXISTS (
  SELECT 1 FROM product_option_groups xpog
    JOIN option_groups xg ON xg.id = xpog.group_id
    CROSS JOIN LATERAL (
      SELECT count(*) AS total, count(*) FILTER (WHERE NOT ${OPTION_STOCK_OUT}) AS ok
        FROM options o WHERE o.group_id = xg.id AND o.active) xn
   WHERE xpog.product_id = p.id AND xg.active AND xg.min_select > 0
     AND xn.total >= CASE WHEN xg.allow_repeat THEN 1 ELSE xg.min_select END
     AND xn.ok < CASE WHEN xg.allow_repeat THEN 1 ELSE xg.min_select END)`;

/** true quando o produto `p` está sem estoque para vender mais uma unidade. */
export const PRODUCT_STOCK_OUT = `(EXISTS (
  SELECT 1 FROM product_recipes r JOIN stock_items s ON s.id = r.stock_item_id
   WHERE r.product_id = p.id AND ${RECIPE_LINE_SHORT}) OR ${REQUIRED_GROUP_SHORT})`;

/** Nomes dos insumos que faltam para o produto `p` (vazio quando dá para vender). */
export const PRODUCT_STOCK_MISSING = `ARRAY(
  SELECT s.name FROM product_recipes r JOIN stock_items s ON s.id = r.stock_item_id
   WHERE r.product_id = p.id AND ${RECIPE_LINE_SHORT} ORDER BY s.name)`;

/**
 * Por produto com ficha: quantas unidades ainda dá para vender (null = sem limite: por peso ou
 * só insumos que podem ficar negativos), se a quantidade é digitável (`direct`), o que falta e a
 * ficha com o saldo de cada insumo.
 */
export const AVAILABILITY_SQL = `
  SELECT r.product_id AS "productId",
         bool_or(${RECIPE_LINE_SHORT}) AS "out",
         min(CASE WHEN s.allow_negative OR p.sold_by_weight THEN NULL
                  ELSE least(greatest(floor(s.quantity / r.quantity), 0), 999999) END)::int AS portions,
         -- Ficha de um insumo só, 1 por venda (controle simples): dá para digitar a quantidade.
         (count(*) = 1 AND bool_and(r.quantity = 1)) AS direct,
         coalesce(array_agg(s.name ORDER BY s.name) FILTER (WHERE ${RECIPE_LINE_SHORT}), '{}') AS missing,
         json_agg(json_build_object(
           'stockItemId', s.id, 'name', s.name, 'unit', s.unit,
           'need', r.quantity::text, 'have', s.quantity::text,
           'short', ${RECIPE_LINE_SHORT}) ORDER BY s.name) AS lines
    FROM product_recipes r
    JOIN stock_items s ON s.id = r.stock_item_id
    JOIN products p ON p.id = r.product_id
   GROUP BY r.product_id`;
