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
      for (const l of out.split('\n')) expect(l.length).toBeLessThanOrEqual(WIDTH);
    }
    const receipt = await renderTemplate(DEFAULT_TEMPLATES.receipt, sampleData('receipt', 'X'));
    expect(receipt).toContain('NÃO É DOCUMENTO FISCAL');
    expect(receipt).toMatch(/^TOTAL\s+R\$ 73,48$/m);
  });

  it('via de entrega: cobrar na porta, troco e endereço', async () => {
    const out = await renderTemplate(
      DEFAULT_TEMPLATES.delivery_slip,
      sampleData('delivery_slip', 'BarBizan Burger'),
    );
    expect(out).toContain('VIA DE ENTREGA');
    expect(out).toContain('Rua das Flores, 120');
    expect(out).toMatch(/^TOTAL A COBRAR:\s+R\$ 73,80$/m);
    expect(out).toMatch(/^Levar de troco:\s+R\$ 6,20$/m);
    expect(out).toContain('Pagamento: Dinheiro');
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
