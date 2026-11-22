import type { TemplateKind } from './templates';

/**
 * "Skill" da IA do layout de impressão: os pedidos que os restaurantes mais fazem, o que cada um
 * quer dizer e o trecho de modelo que resolve. Vai inteira nas instruções da IA (só as receitas
 * do papel aberto). Todo trecho é conferido no teste (`template-ai-skill.test.ts`): Liquid válido
 * e nenhuma linha passando da bobina com o pedido de exemplo. Pedido novo que a IA errou: vira
 * receita aqui, com o trecho que funciona.
 */
export interface TemplateRecipe {
  /** Como o dono costuma pedir (frases reais, curtas). */
  pedidos: string[];
  /** Em quais papéis vale. */
  papeis: TemplateKind[];
  /** O que fazer, em uma ou duas frases. */
  como: string;
  /** Trecho de modelo que resolve (quando há um). */
  trecho?: string;
}

const ALL: TemplateKind[] = ['receipt', 'delivery_slip', 'kitchen_ticket', 'fiscal_footer'];
const ORDER_PAPERS: TemplateKind[] = ['receipt', 'delivery_slip', 'kitchen_ticket'];
const MONEY_PAPERS: TemplateKind[] = ['receipt', 'delivery_slip'];

export const TEMPLATE_RECIPES: TemplateRecipe[] = [
  {
    pedidos: ['nome da loja maior', 'destaque o nome do restaurante'],
    papeis: ['receipt', 'delivery_slip', 'kitchen_ticket'],
    como: 'Nome em letra grande e centralizado (até 21 letras por linha; nome maior quebra sozinho).',
    trecho: `{{ loja.nome | upcase | grande: "centro" }}`,
  },
  {
    pedidos: ['coloque a logo', 'quero a logo no topo', 'tire a logo'],
    papeis: ALL,
    como: 'A logo é sempre a primeira linha e sozinha. Ela só sai se a logo estiver cadastrada na Loja online; se a pessoa disser que não aparece, explique isso. Para tirar, apague o bloco inteiro.',
    trecho: `{% if loja.logo %}{{ loja.logo }}
{% endif %}`,
  },
  {
    pedidos: ['total maior', 'total em destaque', 'valor final grande'],
    papeis: MONEY_PAPERS,
    como: 'Linha do total com largura 21 e letra grande.',
    trecho: `{{ "TOTAL:" | linha: totais.total_formatado, 21 | grande }}`,
  },
  {
    pedidos: ['número do pedido grande', 'quero ver o número de longe'],
    papeis: ORDER_PAPERS,
    como: 'Número com # em letra grande e centralizado.',
    trecho: `{% assign num = "#" | append: pedido.numero %}{{ num | grande: "centro" }}`,
  },
  {
    pedidos: ['mesa em destaque na cozinha', 'mostrar de qual mesa é bem grande'],
    papeis: ['kitchen_ticket', 'receipt'],
    como: 'O local ("Mesa 7", "Comanda 12", "Delivery") em letra grande logo no topo.',
    trecho: `{{ pedido.local | upcase | grande: "centro" }}`,
  },
  {
    pedidos: ['itens em letra grande', 'cozinheiro não enxerga', 'aumenta os itens'],
    papeis: ['kitchen_ticket'],
    como: 'Troque a linha de cada item por letra grande (quebra sozinha em 21 colunas). Mantenha os adicionais e a observação do item embaixo.',
    trecho: `{% for g in grupos %}{% for item in g.itens %}{{ item.quantidade_formatada | append: " " | append: item.nome | grande }}
{% for op in item.opcoes %}{{ "+ " | append: op | quebra: 3 }}
{% endfor %}{% if item.observacao %}{{ "OBS: " | append: item.observacao | quebra: 3 | negrito }}
{% endif %}{% endfor %}{% endfor %}`,
  },
  {
    pedidos: ['tire os preços', 'sem valor dos itens', 'motoboy não precisa ver preço'],
    papeis: MONEY_PAPERS,
    como: 'Na tabela de itens, troque "linha: item.total_formatado" por "quebra: 6" e o cabeçalho "QTDE  DESCRIÇÃO | linha: VALOR" por só "QTDE  DESCRIÇÃO". Não mexa nos totais se a pessoa não pedir.',
    trecho: `{{ "QTDE  DESCRIÇÃO" | negrito }}
{% for item in itens %}{{ item.quantidade_formatada | coluna: 6 | append: item.nome | quebra: 6 }}
{% endfor %}`,
  },
  {
    pedidos: ['observação em destaque', 'observação no topo', 'ninguém lê a observação'],
    papeis: ORDER_PAPERS,
    como: 'Leve o bloco da observação para logo depois do cabeçalho, com o título em letra grande e o texto em negrito.',
    trecho: `{% if pedido.observacao %}{{ "OBSERVAÇÃO" | grande: "centro" }}
{{ pedido.observacao | quebra | negrito }}
{% endif %}`,
  },
  {
    pedidos: ['endereço grande', 'endereço em destaque para o motoboy'],
    papeis: ['delivery_slip'],
    como: 'Endereço em letra grande (quebra em 21 colunas) e telefone em negrito.',
    trecho: `{% if pedido.endereco %}{{ pedido.endereco | upcase | grande }}
{% endif %}{% if pedido.telefone %}{{ "TELEFONE:" | campo: pedido.telefone | negrito }}
{% endif %}`,
  },
  {
    pedidos: ['valor a cobrar bem grande', 'motoboy esquece de cobrar'],
    papeis: ['delivery_slip'],
    como: 'Pago: "PAGO - NÃO COBRAR" em destaque; senão, o valor a cobrar e o troco em letra grande.',
    trecho: `{% if pedido.pago %}{{ "PAGO" | grande: "centro" }}
{{ "NÃO COBRAR" | centro | negrito }}
{% else %}{{ "COBRAR:" | linha: pedido.cobrar_formatado, 21 | grande }}
{% if pedido.levar_de_troco > 0 %}{{ "TROCO:" | linha: pedido.levar_de_troco_formatado, 21 | grande }}
{% endif %}{% endif %}`,
  },
  {
    pedidos: ['sugestão de 10%', 'mostrar a gorjeta sugerida'],
    papeis: ['receipt'],
    como: 'Calcule com times e formate com dinheiro antes de usar em linha (filtro não pode ser argumento de outro).',
    trecho: `{% assign dez = totais.subtotal | times: 0.1 | dinheiro %}{{ "SUGESTÃO 10%:" | linha: dez }}`,
  },
  {
    pedidos: ['quantos itens', 'mostrar o total de itens'],
    papeis: ['receipt', 'delivery_slip'],
    como: 'Conte a lista com size num assign e mostre numa linha.',
    trecho: `{% assign qtd = itens.size | append: "" %}{{ "ITENS NO PEDIDO:" | linha: qtd }}`,
  },
  {
    pedidos: ['senha do Wi-Fi', 'coloca o wifi'],
    papeis: ALL,
    como: 'Duas linhas centralizadas no fim do papel. Use o nome da rede e a senha que a pessoa disser; se ela não disse, pergunte (modelo null).',
    trecho: `{{ "Wi-Fi: MinhaRede" | centro }}
{{ "Senha: cliente123" | centro | negrito }}`,
  },
  {
    pedidos: ['nosso Instagram', 'redes sociais', 'coloca o @'],
    papeis: ALL,
    como: 'Uma linha centralizada no fim. Use o @ que a pessoa disser; se não disse, pergunte.',
    trecho: `{{ "Siga a gente: @minhaloja" | centro }}`,
  },
  {
    pedidos: ['volte sempre', 'mensagem de agradecimento', 'frase no final'],
    papeis: ALL,
    como: 'Frase centralizada em negrito (ou letra grande, se pedirem destaque) no fim do papel, antes do último traço.',
    trecho: `{{ "Obrigado e volte sempre!" | centro | negrito }}`,
  },
  {
    pedidos: ['número da nota no rodapé'],
    papeis: ['fiscal_footer'],
    como: 'O rodapé enxerga só a loja e a nota (número e série).',
    trecho: `{{ "NFC-e " | append: nota.numero | append: " série " | append: nota.serie | centro }}`,
  },
  {
    pedidos: ['tirar o CPF', 'tirar a data', 'tirar o telefone', 'tirar o cliente'],
    papeis: ORDER_PAPERS,
    como: 'Apague a linha inteira do dado, junto com o {% if %} e o {% endif %} dela, sem deixar linha em branco.',
  },
  {
    pedidos: ['economizar papel', 'papel menor', 'está muito comprido'],
    papeis: ORDER_PAPERS,
    como: 'Tire os traços repetidos ("-" | traco) do meio, a linha "NÃO É DOCUMENTO FISCAL" só se a pessoa aceitar, e deixe endereço/telefone da loja de fora. Diga o que tirou.',
  },
  {
    pedidos: ['mais bonito', 'mais profissional', 'igual cupom de mercado'],
    papeis: ALL,
    como: 'Siga o modelo padrão do Comandou (logo, nome grande, campos em coluna, tabela de itens, total grande, traço "=" no começo e no fim). Diga em uma frase o que mudou.',
  },
  {
    pedidos: ['mudar a cor', 'outra fonte', 'itálico', 'sublinhado', 'QR Code', 'foto do produto'],
    papeis: ALL,
    como: 'A térmica não faz isso. Explique e ofereça o mais parecido: negrito, letra grande, centralizar, traços ou a logo da Loja online. Modelo null.',
  },
  {
    pedidos: ['imprimir duas vias', 'cortar o papel', 'imprimir em outra impressora'],
    papeis: ALL,
    como: 'Isso não é do modelo (é da impressora e das rotas da tela Impressão). Diga isso em uma frase. Modelo null.',
  },
];

/** Receitas do papel, em texto para as instruções da IA. */
export function templateAiSkill(kind: TemplateKind): string {
  return TEMPLATE_RECIPES.filter((r) => r.papeis.includes(kind))
    .map((r) => {
      const head = `- Pedidos como: ${r.pedidos.map((p) => `"${p}"`).join(', ')}\n  Faça: ${r.como}`;
      return r.trecho
        ? `${head}\n  Trecho (copie sem espaços na frente):\n<<<\n${r.trecho}\n>>>`
        : head;
    })
    .join('\n');
}
