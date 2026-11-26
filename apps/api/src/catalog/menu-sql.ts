import { OPTION_STOCK_OUT, PRODUCT_STOCK_OUT } from '../stock/availability-sql';

/**
 * Árvore do cardápio para vender (categorias → itens → grupos → opções) num canal.
 * Sem cardápio ativo do tipo do canal, entram todos os itens ativos no preço base; com cardápio,
 * só os itens dele, no preço dele. $1 = tipo do cardápio ('principal' | 'delivery').
 * Item sem estoque pela ficha técnica sai como esgotado ("soldOut") e com "stockOut" — o PDV, o
 * garçom e o cardápio online já bloqueiam a venda sem precisar marcar à mão. Complemento com ficha
 * sem estoque sai com "stockOut" (a tela mostra "Sem estoque" e não deixa escolher).
 * `extra` acrescenta campos do item (ex.: setor para a equipe, destaque para o cliente).
 */
export function menuTreeSql(extra: string) {
  return `SELECT c.id, c.name, c.image_id AS "imageId",
     COALESCE((SELECT json_agg(json_build_object(
         'id', p.id, 'name', p.name, 'description', p.description,
         'price', COALESCE(mi.price, p.price)::text, 'soldOut', (p.sold_out OR st.out), 'stockOut', st.out, 'imageId', p.image_id,
         'soldByWeight', p.sold_by_weight, 'weightTare', p.weight_tare::text, ${extra}
         'optionGroups', COALESCE((SELECT json_agg(json_build_object(
             'id', g.id, 'name', g.name, 'minSelect', g.min_select, 'maxSelect', g.max_select,
             'kind', g.kind, 'charge', g.charge, 'allowRepeat', g.allow_repeat,
             'options', COALESCE((SELECT json_agg(json_build_object('id', o.id, 'name', o.name,
                                    'priceDelta', o.price_delta::text, 'isDefault', o.is_default,
                                    'stockOut', ${OPTION_STOCK_OUT}, 'description', o.description,
                                    'imageUrl', '/api/v1/media/' || o.image_id)
                                  ORDER BY o.position, o.name)
                                 FROM options o WHERE o.group_id = g.id AND o.active), '[]'))
           ORDER BY pog.position)
           FROM product_option_groups pog JOIN option_groups g ON g.id = pog.group_id
          WHERE pog.product_id = p.id AND g.active), '[]'))
       ORDER BY p.position, p.name)
       FROM products p
       LEFT JOIN menus m ON m.active AND m.kind = $1
       LEFT JOIN menu_items mi ON mi.menu_id = m.id AND mi.product_id = p.id
       CROSS JOIN LATERAL (SELECT ${PRODUCT_STOCK_OUT} AS out) st
      WHERE p.category_id = c.id AND p.active AND (m.id IS NULL OR mi.product_id IS NOT NULL)), '[]') AS products
     FROM categories c WHERE c.active ORDER BY c.position, c.name`;
}

/**
 * Pontos de fidelidade que um item rende numa venda da equipe, na conta de `itemPoints` (shared):
 * o número fixo do item ou o preço do canal × pontos por real, para baixo. null quando o programa
 * está desligado, é de carimbos ou não conta pedidos lançados pela equipe; item por peso sem
 * número fixo também fica null (os pontos dependem do peso). Campo extra do `menuTreeSql`.
 */
export const MENU_POINTS = `'points', (SELECT CASE
    WHEN p.loyalty_points IS NOT NULL THEN p.loyalty_points
    WHEN p.sold_by_weight THEN NULL
    ELSE floor(COALESCE(mi.price, p.price) * lp.points_per_real)::int END
  FROM loyalty_programs lp
  WHERE lp.enabled AND lp.mode = 'points' AND lp.count_staff_orders),`;
