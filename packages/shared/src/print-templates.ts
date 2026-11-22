/**
 * O que os modelos de impressão (Liquid) enxergam: variáveis de cada papel e os ajudantes
 * (filtros). A mesma lista aparece ao lado do editor (Impressão › Modelos de impressão) e vai
 * para a IA que ajuda a mudar o modelo, para as duas nunca divergirem.
 */
export type PrintTemplateKind = 'receipt' | 'delivery_slip' | 'kitchen_ticket' | 'fiscal_footer';

export const PRINT_TEMPLATE_LABELS: Record<PrintTemplateKind, string> = {
  receipt: 'Conferência de conta',
  delivery_slip: 'Via de entrega',
  kitchen_ticket: 'Comanda da cozinha',
  fiscal_footer: 'Rodapé do cupom fiscal',
};

export const PRINT_TEMPLATE_HELP: Record<PrintTemplateKind, string> = {
  receipt:
    'Papel que o cliente confere antes de pagar. Não é documento fiscal: você pode mudar tudo.',
  delivery_slip:
    'Vai com o motoboy: cliente, telefone, endereço, itens, quanto cobrar na porta e o troco. Sai pelo botão "Imprimir via de entrega" do pedido.',
  kitchen_ticket: 'Sai em cada setor (cozinha, bar) quando o pedido entra.',
  fiscal_footer:
    'Só o final do cupom da NFC-e é seu (agradecimento, Wi-Fi, redes sociais). O resto do cupom segue o modelo obrigatório da SEFAZ e não muda.',
};

const LOJA: [string, string][] = [
  ['loja.nome', 'nome do restaurante'],
  ['loja.endereco / loja.telefone', 'endereço e telefone (WhatsApp) da Loja online'],
  [
    'loja.logo',
    'a logo da Loja online (vazio se não tiver): {% if loja.logo %}{{ loja.logo }}{% endif %}',
  ],
];

/** Variáveis que cada modelo enxerga, para a cola ao lado do editor. */
export const PRINT_TEMPLATE_VARS: Record<PrintTemplateKind, [string, string][]> = {
  receipt: [
    ...LOJA,
    ['pedido.numero / pedido.hora / pedido.data', 'número, hora (03/11 19:42) e data completa'],
    ['pedido.local / pedido.canal', '"Mesa 7", "Comanda 12" ou o canal (Delivery, Balcão…)'],
    ['pedido.cliente / pedido.telefone', 'cliente'],
    ['pedido.entrega / pedido.endereco', 'é delivery? e o endereço'],
    ['pedido.observacao', 'observação do pedido'],
    ['comanda_inteira / pedido.comanda', 'é a conta da comanda inteira (mesa)? e o número dela'],
    ['impresso_em', 'data e hora em que o papel saiu'],
    [
      'itens (lista)',
      'item.nome, item.quantidade, item.quantidade_formatada (2x ou 0,350kg), item.unidade (un ou kg), item.total_formatado, item.opcoes, item.observacao',
    ],
    ['totais.*', 'subtotal, desconto, acrescimo, entrega, total, falta, tem_extras (+ _formatado)'],
    ['pagamentos (lista)', 'p.forma, p.valor_formatado, p.troco, p.troco_formatado'],
    ['pedido.pagar_na_entrega / pedido.troco_para_formatado', 'como vai pagar e troco para'],
    ['pedido.cpf_cnpj', 'CPF/CNPJ que o cliente pediu na nota'],
  ],
  delivery_slip: [
    ...LOJA,
    ['pedido.numero / pedido.data', 'número, data e hora completas do pedido'],
    ['pedido.canal', 'Delivery ou Retirada'],
    ['pedido.cliente / pedido.telefone / pedido.endereco', 'para quem e onde entregar'],
    ['pedido.cobrar_formatado / pedido.pago', 'quanto cobrar na porta (pago = nada a cobrar)'],
    ['pedido.pagar_na_entrega', 'como o cliente disse que vai pagar'],
    [
      'pedido.troco_para_formatado / pedido.levar_de_troco / pedido.levar_de_troco_formatado',
      'troco',
    ],
    ['pedido.observacao', 'observação do pedido'],
    [
      'itens (lista)',
      'item.nome, item.quantidade_formatada, item.total_formatado, item.opcoes, item.observacao',
    ],
    ['totais.*', 'subtotal, desconto, acrescimo, entrega, total (+ _formatado)'],
    ['pagamentos (lista)', 'p.forma, p.valor_formatado'],
  ],
  kitchen_ticket: [
    ...LOJA,
    ['setor', 'nome do setor (Cozinha, Bar…); várias juntas viram "Chapa + Bar"'],
    ['pedido.*', 'numero, hora, data, local, canal, cliente, observacao'],
    ['itens (lista)', 'item.nome, item.quantidade_formatada, item.opcoes, item.observacao'],
    [
      'grupos (lista)',
      'g.nome e g.itens: os itens separados por setor (pedido de entrega junta vários)',
    ],
  ],
  fiscal_footer: [...LOJA, ['nota.numero / nota.serie', 'número e série da NFC-e']],
};

/** Ajudantes (filtros) próprios do Comandou, além dos do Liquid (upcase, append, size…). */
export const PRINT_TEMPLATE_FILTERS: [string, string][] = [
  ['{{ valor | dinheiro }}', 'R$ 1.234,50'],
  ['{{ "Total" | linha: valor }}', 'texto à esquerda e valor à direita'],
  ['{{ "DATA:" | campo: pedido.data }}', 'rótulo e valor alinhados em coluna'],
  ['{{ "texto" | centro }}', 'centraliza na bobina'],
  ['{{ "-" | traco }}', 'linha separadora'],
  ['{{ texto | quebra }}', 'quebra texto longo em linhas'],
  ['{{ "texto" | negrito }}', 'linha em negrito'],
  ['{{ loja.nome | grande: "centro" }}', 'letra grande (21 colunas)'],
  ['{{ x | coluna: 6 }}', 'coluna de largura fixa (tabela)'],
  ['{{ item.quantidade | qtd }}', '2,000 → 2'],
];
