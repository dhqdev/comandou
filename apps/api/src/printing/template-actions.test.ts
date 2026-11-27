import { describe, expect, it } from 'vitest';
import {
  ActionError,
  addText,
  applyActions,
  findSnippet,
  liquidBlocks,
  readActions,
  removeData,
  removeText,
  scanLiquid,
  templateFacts,
} from './template-actions';
import { overflowLines } from './template-ai-prompt';
import { DEFAULT_TEMPLATES, renderTemplate, sampleData, TEMPLATE_KINDS } from './templates';

const paper = async (body: string, kind: (typeof TEMPLATE_KINDS)[number] = 'receipt') => {
  const data = sampleData(kind, 'Fumaça Burger');
  if (kind !== 'fiscal_footer') data.loja = { ...(data.loja as object), logo: true };
  return renderTemplate(body, data);
};

describe('ações da IA do modelo de impressão', () => {
  it('lê o modelo como o Liquid: aspas dentro da saída e blocos com senão', () => {
    const toks = scanLiquid('A{{ "x }} y" | centro }}{% if a %}B{% else %}C{% endif %}');
    expect(toks.map((t) => t.kind)).toEqual(['text', 'out', 'tag', 'text', 'tag', 'text', 'tag']);
    expect(toks[1]!.inner).toBe('"x }} y" | centro');
    const [b] = liquidBlocks(toks);
    expect(b).toMatchObject({ name: 'if', open: 2, close: 6, branches: [4] });
    // Comentário não vira pedaço de modelo.
    expect(scanLiquid('{% comment %}{{ x {% endcomment %}ok').at(-1)!.inner).toBe('ok');
  });

  it('aceita as palavras que a IA costuma usar e recusa tipo que não existe', () => {
    const [a] = readActions({
      tipo: 'adicionar_texto',
      texto: 'Oi',
      onde: 'Final',
      estilo: 'bold',
    });
    expect(a).toMatchObject({ onde: 'fim', estilo: 'negrito', alinhar: 'centro' });
    expect(readActions(undefined)).toEqual([]);
    expect(() => readActions([{ tipo: 'apagar_tudo' }])).toThrow(/ação 1/);
    expect(() => readActions({ tipo: 'remover' })).toThrow(/dado/);
    expect(() => readActions(Array.from({ length: 13 }, () => ({ tipo: 'padrao' })))).toThrow(/12/);
  });

  it('frase no fim entra antes do último traço, centralizada e no estilo pedido', async () => {
    const body = addText(DEFAULT_TEMPLATES.receipt, 'Volte sempre!', 'fim', 'negrito', 'centro');
    const lines = (await paper(body)).split('\n');
    expect(lines.at(-1)).toMatch(/^=+$/);
    expect(lines.at(-2)).toMatch(/^@@N@@ +Volte sempre!$/);
    // Sem traço no fim (rodapé fiscal): vai para a última linha.
    const foot = addText(DEFAULT_TEMPLATES.fiscal_footer, 'Wi-Fi: Casa', 'fim', 'normal', 'centro');
    expect((await paper(foot, 'fiscal_footer')).split('\n').at(-1)).toMatch(/^ +Wi-Fi: Casa$/);
  });

  it('frase no começo fica logo depois da logo (ou na primeira linha)', async () => {
    const body = addText(DEFAULT_TEMPLATES.receipt, 'Peça pelo app', 'comeco', 'normal', 'centro');
    const lines = (await paper(body)).split('\n');
    expect(lines[0]).toBe('@@LOGO@@');
    expect(lines[1]).toMatch(/^ +Peça pelo app$/);
    const kitchen = addText(
      DEFAULT_TEMPLATES.kitchen_ticket,
      'URGENTE',
      'comeco',
      'grande',
      'centro',
    );
    expect((await paper(kitchen, 'kitchen_ticket')).split('\n')[0]).toMatch(/^@@G@@ +URGENTE$/);
  });

  it('texto com aspas, chaves, marcas e várias linhas não quebra o modelo', async () => {
    const body = addText(
      DEFAULT_TEMPLATES.fiscal_footer,
      'Rede "Casa" {{ x }} @@G@@\nSenha: a\\b',
      'fim',
      'grande',
      'esquerda',
    );
    const out = await paper(body, 'fiscal_footer');
    expect(out).toContain('Rede "Casa"');
    expect(out).toContain('Senha: a\\b');
    expect(out).not.toMatch(/@@G@@.*@@G@@/);
    expect(overflowLines(out)).toEqual([]);
  });

  it('tirar um dado leva a linha e o {% if %} dela, sem linha em branco', async () => {
    const body = removeData(DEFAULT_TEMPLATES.receipt, 'pedido.cpf_cnpj');
    expect(body).not.toContain('cpf_cnpj');
    const out = await paper(body);
    expect(out).not.toContain('CPF/CNPJ');
    expect(out).not.toMatch(/\n\n/);
    // Linha sem if: só a linha.
    expect(await paper(removeData(DEFAULT_TEMPLATES.receipt, 'pedido.data'))).not.toContain(
      'DATA:',
    );
    // Laço: tirar os adicionais tira o for inteiro.
    const k = removeData(DEFAULT_TEMPLATES.kitchen_ticket, 'item.opcoes');
    expect(k).not.toContain('item.opcoes');
    expect(await paper(k, 'kitchen_ticket')).not.toContain('Bacon extra');
    // A versão _formatado conta como o mesmo dado.
    const d = removeData(DEFAULT_TEMPLATES.delivery_slip, 'pedido.troco_para');
    expect(d).not.toContain('troco_para_formatado');
  });

  it('dado que não aparece ou só aparece num senão vira explicação para a IA', () => {
    expect(() => removeData(DEFAULT_TEMPLATES.receipt, 'telefone')).toThrow(ActionError);
    expect(() => removeData(DEFAULT_TEMPLATES.receipt, 'pedido.nada')).toThrow(/não aparece/);
    expect(() => removeData(DEFAULT_TEMPLATES.delivery_slip, 'pedido.pago')).toThrow(/senão/);
  });

  it('tirar texto fixo acha o texto sem ligar para acento e maiúscula', async () => {
    const body = removeText(DEFAULT_TEMPLATES.receipt, 'nao e documento fiscal');
    expect(await paper(body)).not.toContain('DOCUMENTO FISCAL');
    expect(() => removeText(DEFAULT_TEMPLATES.receipt, 'texto que não existe')).toThrow(
      ActionError,
    );
  });

  it('trocar acha o trecho igual ou com espaços diferentes, e recusa o repetido', () => {
    const src = DEFAULT_TEMPLATES.receipt;
    const exact = '{{ "TOTAL:" | linha: totais.total_formatado, 21 | grande }}';
    const [a, b] = findSnippet(src, exact);
    expect(src.slice(a, b)).toBe(exact);
    const [c, d] = findSnippet(src, '{{"TOTAL:"|linha: totais.total_formatado, 21|grande}}');
    expect(src.slice(c, d)).toBe(exact);
    expect(() => findSnippet(src, '{{ "-" | traco }}')).toThrow(/vezes/);
    expect(() => findSnippet(src, '{{ "NADA" }}')).toThrow(/Não achei/);
  });

  it('logo: liga no topo, desliga, e explica quando não dá', async () => {
    const on = applyActions(DEFAULT_TEMPLATES.kitchen_ticket, 'kitchen_ticket', [
      { tipo: 'logo', ligar: true },
    ]);
    expect((await paper(on.body, 'kitchen_ticket')).split('\n')[0]).toBe('@@LOGO@@');
    const off = applyActions(DEFAULT_TEMPLATES.receipt, 'receipt', [
      { tipo: 'logo', ligar: false },
    ]);
    expect(await paper(off.body)).not.toContain('@@LOGO@@');
    expect(() =>
      applyActions(DEFAULT_TEMPLATES.receipt, 'receipt', [{ tipo: 'logo', ligar: true }]),
    ).toThrow(/Loja online/);
    expect(() =>
      applyActions(DEFAULT_TEMPLATES.fiscal_footer, 'fiscal_footer', [
        { tipo: 'logo', ligar: true },
      ]),
    ).toThrow(/rodapé/);
  });

  it('várias ações em ordem; a que falha diz qual foi; nada mudou também é erro', () => {
    const r = applyActions(DEFAULT_TEMPLATES.receipt, 'receipt', [
      { tipo: 'remover', dado: 'pedido.cpf_cnpj' },
      {
        tipo: 'adicionar_texto',
        texto: 'Volte!',
        onde: 'fim',
        estilo: 'normal',
        alinhar: 'centro',
      },
    ]);
    expect(r.done).toHaveLength(2);
    expect(() =>
      applyActions(DEFAULT_TEMPLATES.receipt, 'receipt', [
        { tipo: 'remover', dado: 'pedido.cpf_cnpj' },
        { tipo: 'trocar', de: '{{ "NADA" }}', para: 'x' },
      ]),
    ).toThrow(/Ação 2 \(trocar\)/);
    expect(() => applyActions(DEFAULT_TEMPLATES.receipt, 'receipt', [{ tipo: 'padrao' }])).toThrow(
      /não mudaram nada/,
    );
    expect(applyActions('{{ "x" }}', 'receipt', [{ tipo: 'padrao' }]).body).toBe(
      DEFAULT_TEMPLATES.receipt,
    );
  });

  it('o que o papel mostra hoje: dados, textos fixos e a logo', () => {
    const f = templateFacts(DEFAULT_TEMPLATES.receipt);
    expect(f.logo).toBe(true);
    expect(f.vars).toContain('pedido.cpf_cnpj');
    expect(f.vars).toContain('totais.total');
    expect(f.vars).not.toContain('item');
    expect(f.texts).toContain('NÃO É DOCUMENTO FISCAL');
    expect(f.texts).not.toContain('centro');
    expect(templateFacts(DEFAULT_TEMPLATES.kitchen_ticket).logo).toBe(false);
  });
});
