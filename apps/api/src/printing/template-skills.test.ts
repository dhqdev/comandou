import { describe, expect, it } from 'vitest';
import { applyActions, readActions, type TemplateAction } from './template-actions';
import { overflowLines, readAnswer, templateAiPrompt, templateProblem } from './template-ai-prompt';
import { loadSkills, parseSkill, printAiInstructions, skillsPrompt } from './template-skills';
import {
  checkTemplate,
  DEFAULT_TEMPLATES,
  renderTemplate,
  sampleData,
  TEMPLATE_KINDS,
  type TemplateKind,
} from './templates';

const dataFor = (kind: TemplateKind) => {
  const data = sampleData(kind, 'Fumaça Burger & Co.');
  if (kind !== 'fiscal_footer') data.loja = { ...(data.loja as object), logo: true };
  return data;
};

/** Ações de um bloco ```json da skill: ação, lista de ações ou a resposta inteira da IA. */
function actionsOf(code: string): TemplateAction[] {
  const json = JSON.parse(code) as unknown;
  if (json && typeof json === 'object' && !Array.isArray(json) && 'resposta' in json) {
    const a = readAnswer(code);
    if (!a.ok) throw new Error(a.error);
    return a.acoes;
  }
  return readActions(json);
}

describe('skills da IA do modelo de impressão', () => {
  const skills = loadSkills();

  it('a pasta tem as skills e cada uma tem título, quando usar e papéis', () => {
    expect(skills.length).toBeGreaterThanOrEqual(20);
    for (const s of skills) {
      expect(s.titulo, s.nome).not.toBe('');
      expect(s.quando.length, s.nome).toBeGreaterThan(0);
      expect(s.papeis.length, s.nome).toBeGreaterThan(0);
    }
    for (const kind of TEMPLATE_KINDS)
      expect(skills.filter((s) => s.papeis.includes(kind)).length, kind).toBeGreaterThan(5);
  });

  it('todo exemplo de ação funciona no modelo padrão de cada papel e cabe na bobina', async () => {
    let tested = 0;
    for (const s of skills)
      for (const b of s.blocos.filter((x) => x.lang === 'json')) {
        const actions = actionsOf(b.code);
        for (const kind of b.papeis) {
          if (!actions.length) continue;
          // "Voltar ao padrão" só muda alguma coisa num modelo que já foi mexido.
          const start = actions.some((a) => a.tipo === 'padrao')
            ? `${DEFAULT_TEMPLATES[kind]}\n{{ "mexido" }}`
            : DEFAULT_TEMPLATES[kind];
          const { body } = applyActions(start, kind, actions);
          const issue = await templateProblem(body, dataFor(kind));
          expect(issue, `${s.nome} em ${kind}`).toBeNull();
          tested++;
        }
      }
    expect(tested).toBeGreaterThan(25);
  });

  it('todo trecho de Liquid é válido e cabe na bobina em cada papel', async () => {
    for (const s of skills)
      for (const b of s.blocos.filter((x) => x.lang === 'liquid')) {
        expect(b.code, s.nome).not.toContain('@@');
        expect(() => checkTemplate(b.code), s.nome).not.toThrow();
        for (const kind of b.papeis) {
          const out = await renderTemplate(b.code, dataFor(kind));
          expect(out.trim(), `${s.nome} em ${kind}`).not.toBe('');
          expect(overflowLines(out), `${s.nome} em ${kind}`).toEqual([]);
        }
      }
  });

  it('cada papel recebe só as suas skills (e só os exemplos que valem nele)', () => {
    const kitchen = skillsPrompt('kitchen_ticket');
    expect(kitchen).toContain('Itens em letra grande na cozinha');
    expect(kitchen).not.toContain('Itens sem o preço');
    // Exemplo só da Conferência (cpf_cnpj) não vai para a cozinha.
    expect(kitchen).not.toContain('pedido.cpf_cnpj"}');
    expect(skillsPrompt('fiscal_footer')).not.toContain('totais.');
  });

  it('cabeçalho errado da skill é acusado com o nome do arquivo', () => {
    expect(() => parseSkill('x', 'sem cabeçalho')).toThrow(/x/);
    expect(() => parseSkill('y', '---\ntitulo: T\nquando:\n  - a\npapeis: cozinha\n---\n')).toThrow(
      /papel desconhecido/,
    );
    const ok = parseSkill('z', '---\ntitulo: T\nquando:\n  - a\npapeis: receipt\n---\ncorpo');
    expect(ok.papeis).toEqual(['receipt']);
  });

  it('as instruções preenchem tudo e trazem o formato, as ações e as skills', () => {
    expect(printAiInstructions()).toContain('<<SKILLS>>');
    for (const kind of TEMPLATE_KINDS) {
      const p = templateAiPrompt(kind);
      expect(p, kind).not.toMatch(/<<[A-Z]+>>/);
      expect(p).toContain('42');
      expect(p).toContain('"acoes"');
      expect(p).toContain('adicionar_texto');
      expect(p).toContain('{% include %}');
      expect(p).toContain(DEFAULT_TEMPLATES[kind]);
      expect(p).toContain(skillsPrompt(kind));
    }
    expect(templateAiPrompt('kitchen_ticket')).toContain('grupos');
    // Rodapé fiscal sem logo na cola de variáveis.
    expect(templateAiPrompt('fiscal_footer')).not.toContain('- loja.logo:');
  });
});
