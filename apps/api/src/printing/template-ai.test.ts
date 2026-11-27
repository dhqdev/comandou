import { describe, expect, it } from 'vitest';
import {
  overflowLines,
  readAnswer,
  templateAiUserTurn,
  templateProblem,
} from './template-ai-prompt';
import { DEFAULT_TEMPLATES, sampleData } from './templates';

describe('IA do modelo de impressão', () => {
  it('lê a resposta em JSON com as ações (com ou sem cerca de código)', () => {
    expect(
      readAnswer(
        '{"resposta":"Pronto","acoes":[{"tipo":"adicionar_texto","texto":"Volte sempre!"}]}',
      ),
    ).toEqual({
      ok: true,
      resposta: 'Pronto',
      acoes: [
        {
          tipo: 'adicionar_texto',
          texto: 'Volte sempre!',
          onde: 'fim',
          estilo: 'normal',
          alinhar: 'centro',
        },
      ],
    });
    expect(readAnswer('```json\n{"resposta":"Qual parte?","acoes":[]}\n```')).toEqual({
      ok: true,
      resposta: 'Qual parte?',
      acoes: [],
    });
    // Formato antigo (modelo inteiro) ainda vale, como "reescrever".
    expect(readAnswer('{"resposta":"Ok","modelo":"{{ loja.nome }}"}')).toMatchObject({
      ok: true,
      acoes: [{ tipo: 'reescrever', modelo: '{{ loja.nome }}' }],
    });
  });

  it('resposta que não dá para ler volta o problema para a segunda chance', () => {
    expect(readAnswer('não sei')).toMatchObject({ ok: false });
    expect(readAnswer('{"acoes":[]}')).toMatchObject({ ok: false });
    const bad = readAnswer('{"resposta":"x","acoes":[{"tipo":"voar"}]}');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain('voar');
  });

  it('acha linha que passa da bobina (letra grande conta em dobro)', () => {
    expect(overflowLines(`${'x'.repeat(42)}\n@@G@@${'y'.repeat(21)}`)).toEqual([]);
    expect(overflowLines(`${'x'.repeat(43)}\n@@G@@${'y'.repeat(22)}`)).toHaveLength(2);
  });

  it('confere o modelo proposto: erro de sintaxe, marcas à mão e largura', async () => {
    const data = sampleData('receipt', 'X');
    expect(await templateProblem(DEFAULT_TEMPLATES.receipt, data)).toBeNull();
    expect(await templateProblem('{% if x %}sem fim', data)).toMatchObject({ kind: 'erro' });
    expect(await templateProblem('@@G@@oi', data)).toMatchObject({ kind: 'erro' });
    expect(await templateProblem(`{{ "${'x'.repeat(50)}" }}`, data)).toMatchObject({
      kind: 'largura',
    });
  });

  it('a mensagem leva o papel, o que ele mostra hoje, o modelo e o papel de exemplo', () => {
    const turn = templateAiUserTurn('receipt', 'tire o cpf', DEFAULT_TEMPLATES.receipt, '@@N@@x');
    expect(turn).toContain('Papel: Conferência de conta');
    expect(turn).toContain('tire o cpf');
    expect(turn).toContain('pedido.cpf_cnpj');
    expect(turn).toContain('logo: sim');
    expect(turn).toContain('<<<MODELO');
    expect(turn).toContain('<<<PAPEL');
    expect(templateAiUserTurn('receipt', 'x', '{% if', null)).not.toContain('<<<PAPEL');
  });
});
