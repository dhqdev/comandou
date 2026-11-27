import { describe, expect, it } from 'vitest';
import { FIRST_MS, RETRY_MS, runTemplateAi, type TemplateAiMessage } from './template-ai-flow';
import { DEFAULT_TEMPLATES, renderTemplate, sampleData } from './templates';

/** IA falsa: devolve as respostas na ordem e guarda o que recebeu. */
function fakeAi(...answers: (string | Error)[]) {
  const calls: { messages: TemplateAiMessage[]; ms: number }[] = [];
  return {
    calls,
    complete: async (messages: TemplateAiMessage[], ms: number) => {
      calls.push({ messages: [...messages], ms });
      const next = answers.shift();
      if (next === undefined) throw new Error('a IA falsa não tinha mais respostas');
      if (next instanceof Error) throw next;
      return { text: next, finish: next.endsWith('}') ? 'stop' : 'length' };
    },
  };
}

const ask = (text: string, ai: ReturnType<typeof fakeAi>, body = DEFAULT_TEMPLATES.receipt) =>
  runTemplateAi({
    kind: 'receipt',
    body,
    turns: [{ role: 'user', content: text }],
    data: sampleData('receipt', 'Fumaça'),
    preview: 'PAPEL',
    complete: ai.complete,
  });

const volte = JSON.stringify({
  resposta: 'Coloquei "Volte sempre!" no fim.',
  acoes: [{ tipo: 'adicionar_texto', texto: 'Volte sempre!', estilo: 'negrito' }],
});

describe('conversa com a IA do modelo de impressão', () => {
  it('uma chamada: aplica a ação e devolve o modelo novo', async () => {
    const ai = fakeAi(volte);
    const r = await ask('Coloque "Volte sempre!" no final', ai);
    expect(r).toMatchObject({
      ok: true,
      resposta: 'Coloquei "Volte sempre!" no fim.',
      aviso: null,
    });
    if (!r.ok) throw new Error('falhou');
    expect(await renderTemplate(r.modelo!, sampleData('receipt', 'X'))).toMatch(
      /^@@N@@ +Volte sempre!$/m,
    );
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]!.ms).toBe(FIRST_MS);
    // A mensagem do sistema é a das instruções; o pedido vai na do usuário.
    expect(ai.calls[0]!.messages[0]!.role).toBe('system');
    expect(ai.calls[0]!.messages.at(-1)!.content).toContain('Volte sempre!');
  });

  it('dúvida (sem ações): responde sem mudar o modelo', async () => {
    const r = await ask('dá para pôr cor?', fakeAi('{"resposta":"Não dá.","acoes":[]}'));
    expect(r).toEqual({ ok: true, resposta: 'Não dá.', modelo: null, aviso: null });
  });

  it('ação que não acha o trecho: a IA recebe o problema e acerta na segunda', async () => {
    const wrong = JSON.stringify({
      resposta: 'Pronto',
      acoes: [{ tipo: 'trocar', de: '{{ "NÃO EXISTE" }}', para: 'x' }],
    });
    const ai = fakeAi(wrong, volte);
    const r = await ask('volte sempre no fim', ai);
    expect(r.ok).toBe(true);
    expect(ai.calls).toHaveLength(2);
    expect(ai.calls[1]!.ms).toBe(RETRY_MS);
    const retry = ai.calls[1]!.messages.at(-1)!.content;
    expect(retry).toContain('Não achei este trecho');
    expect(ai.calls[1]!.messages.at(-2)).toEqual({ role: 'assistant', content: wrong });
  });

  it('resposta cortada no limite: a segunda chance pede ações curtas', async () => {
    const ai = fakeAi(
      '{"resposta": "Pronto", "acoes": [{"tipo": "reescrever", "modelo": "{{',
      volte,
    );
    expect((await ask('mude tudo', ai)).ok).toBe(true);
    expect(ai.calls[1]!.messages.at(-1)!.content).toContain('cortada');
  });

  it('duas respostas ruins: não muda nada e conta o porquê (para o registro)', async () => {
    const bad =
      '{"resposta":"x","acoes":[{"tipo":"trocar","de":"{{ \\"-\\" | traco }}","para":""}]}';
    const r = await ask('tire o traço', fakeAi(bad, bad));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('vezes');
  });

  it('linha larga demais: tenta corrigir; se a segunda não responder, vale a primeira com aviso', async () => {
    const wide = JSON.stringify({
      resposta: 'Coloquei.',
      acoes: [
        {
          tipo: 'trocar',
          de: '{{ "NÃO É DOCUMENTO FISCAL" | centro }}',
          para: `{{ "${'x'.repeat(50)}" }}`,
        },
      ],
    });
    const r = await ask('frase comprida', fakeAi(wide, new Error('caiu')));
    expect(r).toMatchObject({ ok: true, resposta: 'Coloquei.' });
    expect(r.ok && r.aviso).toContain('mais larga');
    // Sem nada que sirva e a segunda chance fora do ar: o erro sobe (a tela mostra "tente de novo").
    await expect(ask('x', fakeAi('lixo', new Error('caiu')))).rejects.toThrow('caiu');
  });

  it('modelo do editor com erro: a IA fica sabendo e pode voltar ao padrão', async () => {
    const ai = fakeAi('{"resposta":"Voltei ao padrão.","acoes":[{"tipo":"padrao"}]}');
    const r = await runTemplateAi({
      kind: 'receipt',
      body: '{% if x %}quebrado',
      turns: [
        { role: 'user', content: 'nome maior' },
        { role: 'assistant', content: 'Qual parte?' },
        { role: 'user', content: 'conserte o modelo' },
      ],
      data: sampleData('receipt', 'Fumaça'),
      preview: null,
      complete: ai.complete,
    });
    expect(r).toMatchObject({ ok: true, modelo: DEFAULT_TEMPLATES.receipt });
    const sent = ai.calls[0]!.messages;
    expect(sent.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(sent.at(-1)!.content).toContain('tem um erro');
  });
});
