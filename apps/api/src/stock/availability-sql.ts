/**
 * Disponibilidade pela ficha técnica: um item do cardápio deixa de vender quando algum insumo
 * da ficha não dá para mais uma unidade. Insumo que pode ficar negativo nunca trava a venda.
 * Item vendido por peso (ficha por kg) só trava quando o insumo zera.
 */

/** Condição de "falta" de uma linha da ficha (r = product_recipes, s = stock_items, p = products). */
export const RECIPE_LINE_SHORT = `(NOT s.allow_negative AND
  CASE WHEN p.sold_by_weight THEN s.quantity <= 0 ELSE s.quantity < r.quantity END)`;

/** true quando o produto `p` está sem estoque para vender mais uma unidade. */
export const PRODUCT_STOCK_OUT = `EXISTS (
  SELECT 1 FROM product_recipes r JOIN stock_items s ON s.id = r.stock_item_id
   WHERE r.product_id = p.id AND ${RECIPE_LINE_SHORT})`;

/** Nomes dos insumos que faltam para o produto `p` (vazio quando dá para vender). */
export const PRODUCT_STOCK_MISSING = `ARRAY(
  SELECT s.name FROM product_recipes r JOIN stock_items s ON s.id = r.stock_item_id
   WHERE r.product_id = p.id AND ${RECIPE_LINE_SHORT} ORDER BY s.name)`;

/**
 * Por produto com ficha: quantas unidades ainda dá para vender (null = sem limite: por peso ou
 * só insumos que podem ficar negativos), o que falta e a ficha com o saldo de cada insumo.
 */
export const AVAILABILITY_SQL = `
  SELECT r.product_id AS "productId",
         bool_or(${RECIPE_LINE_SHORT}) AS "out",
         min(CASE WHEN s.allow_negative OR p.sold_by_weight THEN NULL
                  ELSE least(greatest(floor(s.quantity / r.quantity), 0), 999999) END)::int AS portions,
         coalesce(array_agg(s.name ORDER BY s.name) FILTER (WHERE ${RECIPE_LINE_SHORT}), '{}') AS missing,
         json_agg(json_build_object(
           'stockItemId', s.id, 'name', s.name, 'unit', s.unit,
           'need', r.quantity::text, 'have', s.quantity::text,
           'short', ${RECIPE_LINE_SHORT}) ORDER BY s.name) AS lines
    FROM product_recipes r
    JOIN stock_items s ON s.id = r.stock_item_id
    JOIN products p ON p.id = r.product_id
   GROUP BY r.product_id`;
