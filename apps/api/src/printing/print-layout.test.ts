import {
  compileLayout,
  LAYOUT_BLOCKS,
  LAYOUT_PRESETS,
  layoutBlocksFor,
  layoutPreset,
  newLayoutBlock,
  parsePrintLines,
  plainPrintText,
  printLineColumns,
  readLayout,
  splitLayoutPreview,
} from '@comandou/shared';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  renderTemplate,
  sampleData,
  TEMPLATE_KINDS,
  TEMPLATE_MAX,
  WIDTH,
} from './templates';

/** Dados de exemplo com logo, delivery e comanda, para passar por todos os caminhos. */
function data(kind: (typeof TEMPLATE_KINDS)[number]) {
  const d = sampleData(kind, 'Fumaça Burger');
  if (kind !== 'fiscal_footer') (d.loja as Record<string, unknown>).logo = true;
  return d;
}

describe('editor visual dos modelos de impressão', () => {
  it('todo estilo pronto vira um modelo válido que cabe na bobina e volta para o visual', async () => {
    for (const kind of TEMPLATE_KINDS)
      for (const p of LAYOUT_PRESETS) {
        const layout = layoutPreset(kind, p.id);
        const body = compileLayout(kind, layout);
        expect(body.length, `${kind}/${p.id}`).toBeLessThan(TEMPLATE_MAX);
        const out = await renderTemplate(body, data(kind));
        expect(out.length, `${kind}/${p.id}`).toBeGreaterThan(5);
        for (const l of parsePrintLines(out))
          expect(printLineColumns(l), `${kind}/${p.id}: ${JSON.stringify(l)}`).toBeLessThanOrEqual(
            WIDTH,
          );
        for (const l of plainPrintText(out).split('\n'))
          expect(l.length).toBeLessThanOrEqual(WIDTH);
        const back = readLayout(kind, body);
        expect(back?.exact, `${kind}/${p.id}`).toBe(true);
        expect(back!.layout.blocks.map((b) => b.type)).toEqual(layout.blocks.map((b) => b.type));
      }
  });

  it('o Clássico imprime igual ao modelo padrão do Comandou', async () => {
    for (const kind of TEMPLATE_KINDS) {
      const body = compileLayout(kind, layoutPreset(kind, 'classico'));
      expect(await renderTemplate(body, data(kind)), kind).toBe(
        await renderTemplate(DEFAULT_TEMPLATES[kind], data(kind)),
      );
    }
  });

  it('todos os blocos de cada papel, em todos os estilos, montam sem erro', async () => {
    for (const kind of TEMPLATE_KINDS) {
      const types = layoutBlocksFor(kind);
      for (const size of ['normal', 'grande'] as const)
        for (const align of ['esquerda', 'centro', 'direita'] as const) {
          const blocks = types.map((t) =>
            newLayoutBlock(t, {
              size,
              align,
              bold: true,
              upper: true,
              text: t === 'qr' ? 'https://instagram.com/fumaca' : LAYOUT_BLOCKS[t].start?.text,
            }),
          );
          const out = await renderTemplate(compileLayout(kind, { blocks }), data(kind));
          for (const l of parsePrintLines(out))
            expect(printLineColumns(l), `${kind} ${size} ${align}`).toBeLessThanOrEqual(WIDTH);
        }
    }
  });

  it('a prévia sabe de qual bloco é cada linha, sem mudar o texto', async () => {
    const layout = layoutPreset('receipt', 'classico');
    const real = await renderTemplate(compileLayout('receipt', layout), data('receipt'));
    const marked = await renderTemplate(compileLayout('receipt', layout, true), data('receipt'));
    const split = splitLayoutPreview(marked);
    expect(split.text).toBe(real);
    expect(split.owners).toHaveLength(real.split('\n').length);
    // A primeira linha é a logo (o primeiro bloco); o TOTAL é do bloco Totais.
    expect(split.owners[0]).toBe(layout.blocks[0]!.id);
    const total = real.split('\n').findIndex((l) => l.includes('TOTAL:'));
    expect(layout.blocks.find((b) => b.id === split.owners[total])?.type).toBe('totais');
  });

  it('texto do lojista não abre tag do Liquid nem vira marca de impressão', async () => {
    const blocks = [
      newLayoutBlock('texto', {
        text: 'Wi-Fi: {{ senha }} {% raw %} "aspas" e \'apóstrofo\' @@QR@@x',
      }),
      newLayoutBlock('texto', { text: 'linha 1\nlinha 2' }),
    ];
    const body = compileLayout('fiscal_footer', { blocks });
    const out = await renderTemplate(body, data('fiscal_footer'));
    expect(out).not.toContain('@@QR@@');
    expect(out).toContain('(( senha ))');
    expect(out).toContain('linha 2');
    expect(readLayout('fiscal_footer', body)?.exact).toBe(true);
    // Acento e emoji voltam iguais do comentário guardado.
    const accents = [newLayoutBlock('texto', { text: 'Ação ç ã — 🍔' })];
    expect(
      readLayout('receipt', compileLayout('receipt', { blocks: accents }))!.layout.blocks[0].text,
    ).toBe('Ação ç ã — 🍔');
  });

  it('mexeu no código depois: deixa de ser do visual; sem a marca, nem é do visual', () => {
    const body = compileLayout('receipt', layoutPreset('receipt', 'moderno'));
    expect(readLayout('receipt', body + '\n{{ "x" }}')?.exact).toBe(false);
    expect(readLayout('receipt', DEFAULT_TEMPLATES.receipt)).toBeNull();
    expect(readLayout('receipt', '{% comment %}comandou-visual @@@{% endcomment %}')).toBeNull();
  });

  it('QR Code vira a marca do aplicativo pelo filtro qrcode, sem "@@" escrito no modelo', async () => {
    const blocks = [newLayoutBlock('qr', { text: ' https://instagram.com/fumaca ' })];
    const body = compileLayout('receipt', { blocks });
    expect(body).not.toContain('@@');
    expect(await renderTemplate(body, data('receipt'))).toBe('@@QR@@https://instagram.com/fumaca');
    // Sem link (só o "https://" do começo), o bloco não imprime nada.
    const empty = compileLayout('receipt', { blocks: [newLayoutBlock('qr')] });
    expect(await renderTemplate(`${empty}{{ "x" }}`, data('receipt'))).toBe('x');
  });

  it('bloco escondido não sai no papel e continua guardado', async () => {
    const layout = layoutPreset('fiscal_footer', 'classico');
    layout.blocks[0].hidden = true;
    const body = compileLayout('fiscal_footer', layout);
    expect(await renderTemplate(body, data('fiscal_footer'))).not.toContain('Obrigado');
    expect(readLayout('fiscal_footer', body)!.layout.blocks[0].hidden).toBe(true);
  });
});
