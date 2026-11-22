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
