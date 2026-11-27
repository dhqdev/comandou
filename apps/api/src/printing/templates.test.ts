import { parsePrintLines, plainPrintText, printLineColumns } from '@comandou/shared';
import { describe, expect, it } from 'vitest';
import {
  checkTemplate,
  DEFAULT_TEMPLATES,
  renderTemplate,
  sampleData,
  TEMPLATE_KINDS,
  WIDTH,
} from './templates';

describe('modelos de impressão (Liquid)', () => {
  it('os modelos iniciais montam o cupom sem passar da largura da bobina', async () => {
    for (const kind of TEMPLATE_KINDS) {
      const out = await renderTemplate(DEFAULT_TEMPLATES[kind], sampleData(kind, 'Bar do Zé'));
      expect(out.length).toBeGreaterThan(10);
      for (const l of parsePrintLines(out)) expect(printLineColumns(l)).toBeLessThanOrEqual(WIDTH);
      // Sem as marcas (aplicativo antigo), também cabe na bobina.
      for (const l of plainPrintText(out).split('\n')) expect(l.length).toBeLessThanOrEqual(WIDTH);
    }
    const receipt = await renderTemplate(DEFAULT_TEMPLATES.receipt, sampleData('receipt', 'X'));
    expect(receipt).toContain('NÃO É DOCUMENTO FISCAL');
    expect(receipt).toMatch(/^@@G@@TOTAL:\s+R\$ 73,48$/m);
    expect(receipt).toMatch(/^@@N@@PEDIDO:\s+#128$/m);
    expect(receipt).toMatch(/^@@N@@OBSERVAÇÃO:$/m);
    expect(receipt).toMatch(/^@@N@@QTDE  DESCRIÇÃO\s+VALOR$/m);
    expect(receipt).toMatch(/^2x {4}X-Burger da casa\s+R\$ 59,80$/m);
    // Sem logo cadastrada, nada de linha da logo.
    expect(receipt).not.toContain('@@LOGO@@');
    const comLogo = sampleData('receipt', 'X');
    (comLogo.loja as Record<string, unknown>).logo = true;
    expect(await renderTemplate(DEFAULT_TEMPLATES.receipt, comLogo)).toMatch(/^@@LOGO@@$/m);
  });

  it('via de entrega: cobrar na porta, troco e endereço', async () => {
    const out = await renderTemplate(
      DEFAULT_TEMPLATES.delivery_slip,
      sampleData('delivery_slip', 'BarBizan Burger'),
    );
    expect(out).toContain('VIA DE ENTREGA');
    expect(out).toContain('Rua das Flores, 120');
    expect(out).toMatch(/^@@G@@A COBRAR:\s+R\$ 73,80$/m);
    expect(out).toMatch(/^@@N@@LEVAR DE TROCO:\s+R\$ 6,20$/m);
    expect(out).toMatch(/^PAGAMENTO: Dinheiro$/m);
  });

  it('via de entrega paga em parte: total, já pago e o que cobrar na porta', async () => {
    const data = sampleData('delivery_slip', 'Fumaça');
    Object.assign(data.pedido as object, {
      cobrar: 53.8,
      cobrar_formatado: 'R$ 53,80',
      levar_de_troco: 0,
      pagar_na_entrega: 'Cartão de débito',
    });
    data.pagamentos = [{ forma: 'Pix', valor: 20, valor_formatado: 'R$ 20,00' }];
    const out = await renderTemplate(DEFAULT_TEMPLATES.delivery_slip, data);
    expect(out).toMatch(/^TOTAL:\s+R\$ 73,80$/m);
    expect(out).toMatch(/^JÁ PAGO:\s+R\$ 20,00$/m);
    expect(out).toMatch(/^@@G@@A COBRAR:\s+R\$ 53,80$/m);
    // Sem taxa nem desconto, o subtotal seria igual ao total: não sai.
    const plain = sampleData('delivery_slip', 'Fumaça');
    Object.assign(plain.totais as object, { entrega: 0, tem_extras: false });
    expect(await renderTemplate(DEFAULT_TEMPLATES.delivery_slip, plain)).not.toContain('SUBTOTAL');
  });

  it('comanda da cozinha: número e mesa grandes no meio, nome comprido com recuo', async () => {
    const data = sampleData('kitchen_ticket', 'Fumaça');
    const long = {
      nome: 'Hambúrguer artesanal duplo com cheddar cremoso e bacon crocante',
      quantidade_formatada: '0,350kg',
      opcoes: [],
      observacao: null,
    };
    data.grupos = [{ nome: 'Cozinha', itens: [...(data.itens as object[]), long] }];
    const out = await renderTemplate(DEFAULT_TEMPLATES.kitchen_ticket, data);
    expect(out).toMatch(/^@@G@@ {5}PEDIDO #128$/m);
    expect(out).toMatch(/^@@G@@ +MESA 7$/m);
    expect(out).toMatch(/^@@N@@Sem cebola em tudo$/m);
    expect(out).toMatch(/^@@N@@0,350kg Hambúrguer/m);
    expect(out).toMatch(/^@@N@@ {8}\S/m);
    for (const l of parsePrintLines(out)) expect(printLineColumns(l)).toBeLessThanOrEqual(WIDTH);
  });

  it('rodapé do cupom fiscal enxerga a loja sem logo, como na impressão', async () => {
    const data = sampleData('fiscal_footer', 'Fumaça');
    expect((data.loja as Record<string, unknown>).logo).toBeUndefined();
    expect(data.pedido).toBeUndefined();
    expect(await renderTemplate('{% if loja.logo %}{{ loja.logo }}{% endif %}x', data)).toBe('x');
  });

  it('recuo: a primeira linha na margem, as de baixo recuadas', async () => {
    const out = await renderTemplate(`{{ t | recuo: 3 }}`, {
      t: '2x Hambúrguer artesanal duplo com cheddar cremoso e bacon crocante',
    });
    const [first, ...rest] = out.split('\n');
    expect(first).toMatch(/^2x Hambúrguer/);
    expect(rest.length).toBeGreaterThan(0);
    for (const l of rest) expect(l).toMatch(/^ {3}\S/);
    for (const l of out.split('\n')) expect(l.length).toBeLessThanOrEqual(WIDTH);
    expect(await renderTemplate(`{{ "curto" | recuo: 3 }}`, {})).toBe('curto');
    // Palavra enorme no começo (link): não estoura nem vira uma letra por linha.
    const link = await renderTemplate(`{{ t | recuo: 3 }}`, { t: `${'x'.repeat(60)} fim` });
    expect(link.split('\n').length).toBeLessThan(4);
    for (const l of link.split('\n')) expect(l.length).toBeLessThanOrEqual(WIDTH);
  });

  it('filtros: dinheiro, linha, centro, qtd e quebra', async () => {
    const out = await renderTemplate(
      `{{ 1234.5 | dinheiro }}|{{ "A" | linha: "B" }}|{{ "2.500" | qtd }}|{{ "oi" | centro }}`,
      {},
    );
    const [money, row, qty, center] = out.split('|');
    expect(money).toBe('R$ 1.234,50');
    expect(row).toBe(`A${' '.repeat(WIDTH - 2)}B`);
    expect(qty).toBe('2,5');
    expect(center.trim()).toBe('oi');
    const wrapped = await renderTemplate(`{{ t | quebra }}`, { t: 'palavra '.repeat(20) });
    for (const l of wrapped.split('\n')) expect(l.length).toBeLessThanOrEqual(WIDTH);
  });

  it('filtros do cupom: campo, coluna, linha com recuo, negrito e grande', async () => {
    expect(await renderTemplate(`{{ "DATA:" | campo: "03/11/2026" }}`, {})).toBe(
      'DATA:      03/11/2026',
    );
    const addr = await renderTemplate(`{{ "ENDEREÇO:" | campo: t }}`, {
      t: 'Rua muito comprida das Flores Amarelas, 1200 - Bairro Jardim Novo',
    });
    const lines = addr.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines.slice(1)) expect(l.startsWith(' '.repeat(11))).toBe(true);
    expect(await renderTemplate(`[{{ "0,350kg" | coluna: 6 }}]`, {})).toBe('[0,350kg ]');
    const item = await renderTemplate(
      `{{ "2x" | coluna: 6 | append: n | linha: "R$ 10,00", 42, 6 }}`,
      { n: 'Hambúrguer artesanal duplo com bacon e cheddar cremoso' },
    );
    const [first, ...rest] = item.split('\n');
    expect(first).toMatch(/^2x {4}Hambúrguer.*R\$ 10,00$/);
    expect(first.length).toBe(WIDTH);
    for (const l of rest) expect(l).toMatch(/^ {6}\S/);
    expect(await renderTemplate(`{{ "Oi" | negrito }}`, {})).toBe('@@N@@Oi');
    expect(await renderTemplate(`{{ "TOTAL:" | linha: "R$ 9,00", 21 | grande }}`, {})).toBe(
      `@@G@@TOTAL:${' '.repeat(8)}R$ 9,00`,
    );
    const big = await renderTemplate(`{{ t | grande: "centro" }}`, {
      t: 'Hamburgueria do Bairro Feliz',
    });
    for (const l of parsePrintLines(big)) {
      expect(l.kind).toBe('big');
      expect(printLineColumns(l)).toBeLessThanOrEqual(WIDTH);
    }
  });

  it('texto do cliente nunca vira marca de impressão', async () => {
    const out = await renderTemplate(`{{ pedido.observacao | quebra }}\n{{ loja.logo }}`, {
      pedido: { observacao: '@@QR@@https://golpe.example @@G@@ENORME' },
      loja: { logo: true },
    });
    expect(out).not.toMatch(/^@@(QR|G)@@/m);
    expect(out).toMatch(/^@@LOGO@@$/m);
  });

  it('não lê arquivos, não aceita filtro desconhecido e corta laço gigante', async () => {
    expect(() => checkTemplate('{% include "/etc/passwd" %}')).toThrow(/incluir/);
    expect(() => checkTemplate('{%- render "x" %}')).toThrow(/incluir/);
    await expect(renderTemplate('{{ a | apaga_tudo }}', {})).rejects.toThrow(/Filtro/);
    await expect(
      renderTemplate('{% for i in (1..100000000) %}x{% endfor %}', {}),
    ).rejects.toThrow();
    expect(await renderTemplate('[{{ o.constructor }}]', { o: {} })).toBe('[]');
  });
});
