import { describe, expect, it } from 'vitest';
import { overflowLines } from './template-ai.service';
import { templateAiPrompt } from './template-ai-prompt';
import { TEMPLATE_RECIPES, templateAiSkill } from './template-ai-skill';
import { checkTemplate, renderTemplate, sampleData, TEMPLATE_KINDS } from './templates';

describe('skill da IA do layout de impressão', () => {
  it('todo trecho é Liquid válido e cabe na bobina em cada papel', async () => {
    for (const r of TEMPLATE_RECIPES) {
      if (!r.trecho) continue;
      expect(r.trecho).not.toContain('@@');
      for (const kind of r.papeis) {
        const data = sampleData(kind, 'Fumaça Burger & Co.');
        data.loja = { ...(data.loja as object), logo: true };
        expect(() => checkTemplate(r.trecho!), r.pedidos[0]).not.toThrow();
        const out = await renderTemplate(r.trecho, data);
        expect(out.trim(), `${r.pedidos[0]} em ${kind}`).not.toBe('');
        expect(overflowLines(out), `${r.pedidos[0]} em ${kind}`).toEqual([]);
      }
    }
  });

  it('cada papel tem receitas e elas vão nas instruções', () => {
    for (const kind of TEMPLATE_KINDS) {
      const skill = templateAiSkill(kind);
      expect(skill.length).toBeGreaterThan(200);
      expect(templateAiPrompt(kind)).toContain(skill);
    }
    expect(templateAiSkill('kitchen_ticket')).toContain('g.itens');
    expect(templateAiSkill('fiscal_footer')).not.toContain('totais.');
  });
});
