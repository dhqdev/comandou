import { describe, expect, it } from 'vitest';
import { overflowLines, readAnswer } from './template-ai.service';
import { templateAiPrompt, templateAiUserTurn } from './template-ai-prompt';
import { TEMPLATE_KINDS } from './templates';

describe('IA do modelo de impressão', () => {
  it('lê a resposta em JSON (com ou sem cerca de código) e recusa o resto', () => {
    expect(readAnswer('{"resposta":"Pronto","modelo":"{{ loja.nome }}"}')).toEqual({
      resposta: 'Pronto',
      modelo: '{{ loja.nome }}',
    });
    expect(readAnswer('```json\n{"resposta":"Qual cor?","modelo":null}\n```')).toEqual({
      resposta: 'Qual cor?',
      modelo: null,
    });
    expect(readAnswer('não sei')).toBeNull();
    expect(readAnswer('{"modelo":"x"}')).toBeNull();
  });

  it('acha linha que passa da bobina (letra grande conta em dobro)', () => {
    expect(overflowLines(`${'x'.repeat(42)}\n@@G@@${'y'.repeat(21)}`)).toEqual([]);
    expect(overflowLines(`${'x'.repeat(43)}\n@@G@@${'y'.repeat(22)}`)).toHaveLength(2);
  });

  it('as instruções cobrem a largura, as variáveis, os ajudantes e o formato da resposta', () => {
    for (const kind of TEMPLATE_KINDS) {
      const p = templateAiPrompt(kind);
      expect(p).toContain('42');
      expect(p).toContain('loja.logo');
      expect(p).toContain('| campo:');
      expect(p).toContain('"resposta"');
      expect(p).toContain('{% include %}');
    }
    expect(templateAiPrompt('kitchen_ticket')).toContain('grupos');
    expect(templateAiUserTurn('maior', '{{ x }}', null)).not.toContain('PAPEL');
    expect(templateAiUserTurn('maior', '{{ x }}', '@@N@@x')).toContain('<<<PAPEL');
  });
});
