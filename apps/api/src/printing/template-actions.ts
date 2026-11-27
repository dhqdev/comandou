import { z } from 'zod';
import { DEFAULT_TEMPLATES, TEMPLATE_MAX, type TemplateKind } from './templates';

/**
 * Ações da IA do modelo de impressão: as "skills" que o servidor executa. A IA diz o QUE mudar em
 * poucas palavras (pôr uma frase no fim, tirar um dado, trocar um trecho) e este código muda o
 * modelo. Antes ela devolvia o modelo inteiro dentro do JSON: a resposta era longa (lenta), vinha
 * cortada e quebrava aspas e chaves do Liquid (0.274, "demorou muito e deu erro").
 *
 * Tudo aqui é puro (sem banco, sem rede): testado em `template-actions.test.ts`. Ação nova: um
 * esquema em `ACTION`, o caso em `applyOne`, uma linha nas instruções
 * (`assets/ai/impressao/instrucoes.md`) e uma skill com o exemplo (o teste aplica o exemplo).
 */

/** Erro de uma ação, em palavras para a IA corrigir na segunda chance. */
export class ActionError extends Error {}

// ------------------------------------------------------------------------- leitura das ações

/** Sem acento e em minúsculas, para aceitar "Começo", "começo" e "comeco". */
const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Palavra da IA → valor aceito (ela às vezes escreve "bold", "final", "topo"). */
function pick<T extends string>(map: Record<string, T>, fallback: T) {
  return z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? fallback : (map[fold(String(v))] ?? v)),
    z.enum([...new Set(Object.values(map))] as [T, ...T[]]),
  );
}

const WHERE = pick(
  {
    fim: 'fim',
    final: 'fim',
    rodape: 'fim',
    embaixo: 'fim',
    baixo: 'fim',
    end: 'fim',
    comeco: 'comeco',
    inicio: 'comeco',
    topo: 'comeco',
    cima: 'comeco',
    start: 'comeco',
  },
  'fim',
);
const STYLE = pick(
  {
    normal: 'normal',
    simples: 'normal',
    comum: 'normal',
    negrito: 'negrito',
    bold: 'negrito',
    forte: 'negrito',
    grande: 'grande',
    big: 'grande',
    maior: 'grande',
    destaque: 'grande',
  },
  'normal',
);
const ALIGN = pick(
  {
    centro: 'centro',
    centralizado: 'centro',
    centralizar: 'centro',
    meio: 'centro',
    center: 'centro',
    esquerda: 'esquerda',
    left: 'esquerda',
  },
  'centro',
);

const ACTION = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('adicionar_texto'),
    texto: z.string().trim().min(1).max(300),
    onde: WHERE,
    estilo: STYLE,
    alinhar: ALIGN,
  }),
  z.object({
    tipo: z.literal('remover'),
    dado: z.string().trim().max(80).optional(),
    texto: z.string().trim().max(200).optional(),
  }),
  z.object({ tipo: z.literal('logo'), ligar: z.boolean() }),
  z.object({
    tipo: z.literal('trocar'),
    de: z.string().min(1).max(TEMPLATE_MAX),
    para: z.string().max(TEMPLATE_MAX),
  }),
  z.object({ tipo: z.literal('padrao') }),
  z.object({ tipo: z.literal('reescrever'), modelo: z.string().min(1).max(TEMPLATE_MAX) }),
]);

export type TemplateAction = z.infer<typeof ACTION>;
export const ACTION_TYPES = [
  'adicionar_texto',
  'remover',
  'logo',
  'trocar',
  'padrao',
  'reescrever',
] as const;

/** Lê as ações da IA (uma por uma, para o erro dizer qual). Lança ActionError. */
export function readActions(raw: unknown): TemplateAction[] {
  const list = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];
  if (list.length > 12) throw new ActionError('Mande no máximo 12 ações por vez.');
  return list.map((a, i) => {
    const r = ACTION.safeParse(a);
    if (!r.success) {
      const tipo = (a as { tipo?: unknown } | null)?.tipo;
      throw new ActionError(
        `A ação ${i + 1} ${typeof tipo === 'string' ? `("${tipo}") ` : ''}veio num formato que não existe. Tipos: ${ACTION_TYPES.join(', ')}.`,
      );
    }
    if (r.data.tipo === 'remover' && !r.data.dado && !r.data.texto)
      throw new ActionError(`A ação ${i + 1} (remover) precisa de "dado" ou de "texto".`);
    return r.data;
  });
}

// ------------------------------------------------------------------- leitura do modelo (Liquid)

/** Pedaço do modelo: texto solto, {{ saída }} ou {% tag %}. */
export interface LiquidToken {
  kind: 'text' | 'out' | 'tag';
  start: number;
  end: number;
  /** Conteúdo sem as chaves (e sem o "-" do controle de espaço). */
  inner: string;
  /** Tag: nome (if, endif, for…) e o resto. */
  name?: string;
  args?: string;
}

/** Fim de um texto entre aspas (com \" dentro), igual ao Liquid. */
function skipQuoted(src: string, at: number) {
  const q = src[at];
  let i = at + 1;
  while (i < src.length) {
    if (src[i] === '\\') i += 2;
    else if (src[i] === q) return i + 1;
    else i++;
  }
  return src.length;
}

/**
 * Corta o modelo em pedaços como o Liquid faz: {{ }} respeita aspas ({{ "a }} b" }} é uma saída
 * só), {% %} vai até o primeiro %}. comment e raw guardam o miolo como texto.
 */
export function scanLiquid(src: string): LiquidToken[] {
  const out: LiquidToken[] = [];
  let i = 0;
  let textStart = 0;
  const pushText = (end: number) => {
    if (end > textStart)
      out.push({ kind: 'text', start: textStart, end, inner: src.slice(textStart, end) });
  };
  while (i < src.length) {
    const isOut = src.startsWith('{{', i);
    if (!isOut && !src.startsWith('{%', i)) {
      i++;
      continue;
    }
    let j = i + 2;
    if (isOut) {
      while (j < src.length && !src.startsWith('}}', j))
        j = src[j] === '"' || src[j] === "'" ? skipQuoted(src, j) : j + 1;
    } else {
      const k = src.indexOf('%}', j);
      j = k < 0 ? src.length : k;
    }
    if (j >= src.length) break; // sem fechar: o resto é texto (o Liquid acusa o erro)
    pushText(i);
    const end = j + 2;
    const inner = src
      .slice(i + 2, j)
      .replace(/^-|-$/g, '')
      .trim();
    if (isOut) out.push({ kind: 'out', start: i, end, inner });
    else {
      const m = /^(\w+)\s*([\s\S]*)$/.exec(inner);
      const name = m?.[1] ?? '';
      out.push({ kind: 'tag', start: i, end, inner, name, args: (m?.[2] ?? '').trim() });
      if (name === 'comment' || name === 'raw') {
        const close = new RegExp(`\\{%-?\\s*end${name}\\s*-?%\\}`, 'g');
        close.lastIndex = end;
        const c = close.exec(src);
        if (c) {
          if (c.index > end) out.push({ kind: 'text', start: end, end: c.index, inner: '' });
          out.push({
            kind: 'tag',
            start: c.index,
            end: c.index + c[0].length,
            inner: `end${name}`,
            name: `end${name}`,
            args: '',
          });
          i = textStart = c.index + c[0].length;
          continue;
        }
      }
    }
    i = textStart = end;
  }
  textStart = Math.min(textStart, src.length);
  pushText(src.length);
  return out;
}

/** Bloco {% if %}…{% endif %} (ou unless, for, case, capture): índices dos pedaços. */
export interface LiquidBlock {
  name: string;
  open: number;
  close: number;
  /** elsif, else, when dentro dele (no nível dele). */
  branches: number[];
}

const OPENERS = new Set(['if', 'unless', 'for', 'case', 'capture', 'tablerow']);
const BRANCHES = new Set(['elsif', 'else', 'when']);

export function liquidBlocks(toks: LiquidToken[]): LiquidBlock[] {
  const done: LiquidBlock[] = [];
  const stack: LiquidBlock[] = [];
  toks.forEach((t, i) => {
    if (t.kind !== 'tag' || !t.name) return;
    if (OPENERS.has(t.name)) stack.push({ name: t.name, open: i, close: -1, branches: [] });
    else if (BRANCHES.has(t.name)) stack.at(-1)?.branches.push(i);
    else if (t.name.startsWith('end') && OPENERS.has(t.name.slice(3))) {
      // Fecha o último bloco com o mesmo nome (o Liquid acusa o que estiver trocado).
      const at = stack.map((b) => b.name).lastIndexOf(t.name.slice(3));
      if (at < 0) return;
      const [b] = stack.splice(at);
      b!.close = i;
      done.push(b!);
    }
  });
  return done;
}

const QUOTED = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
/** Expressão sem os textos entre aspas (para achar variáveis sem pegar "pedido.x" escrito). */
const code = (s: string) => s.replace(QUOTED, '""');

/** Casa a variável inteira (e a versão _formatado dela): pedido.troco_para, não pedido.troco_paraX. */
function varPattern(name: string) {
  const v = name.trim().replace(/[^\w.]/g, '');
  if (!v) return null;
  const esc = v.replace(/\./g, '\\.');
  return new RegExp(`(^|[^\\w.])${esc}(_formatado)?(?![\\w])`);
}

/** O que o modelo mostra hoje: dados, textos fixos e se tem logo (vai para a IA). */
export function templateFacts(body: string) {
  const vars = new Set<string>();
  const texts = new Set<string>();
  for (const t of scanLiquid(body)) {
    if (t.kind === 'text') continue;
    const expr = t.kind === 'out' ? t.inner : (t.args ?? '');
    for (const m of code(expr).matchAll(
      /(?<![\w.])(loja|pedido|totais|nota|item|setor|comanda_inteira|impresso_em|pagamentos|grupos)(\.[a-z_]\w*)?(?!\w)/g,
    )) {
      const v = m[0].replace(/\.(size|first|last)$/, '').replace(/_formatado$/, '');
      // Variável do laço sozinha ("item" de "for item in itens") não é um dado do papel.
      if (v.includes('.') || !['item', 'loja', 'pedido', 'totais', 'nota'].includes(v)) vars.add(v);
    }
    if (t.kind === 'out')
      for (const m of t.inner.matchAll(QUOTED)) {
        const s = m[0].slice(1, -1).replace(/\\(.)/g, '$1');
        if (s.trim().length > 2 && s !== 'centro') texts.add(s);
      }
  }
  return { vars: [...vars], texts: [...texts], logo: vars.has('loja.logo') };
}

// ----------------------------------------------------------------------- mudanças no modelo

/** Começo de linha no papel: antes só há tags (não imprimem) desde a última quebra. */
function atLineStart(src: string, toks: LiquidToken[], index: number) {
  for (let k = index - 1; k >= 0; k--) {
    const t = toks[k]!;
    if (t.kind === 'tag') continue;
    if (t.kind === 'out') return false;
    const tail = t.inner.replace(/[ \t]+$/, '');
    if (!tail) continue;
    return tail.endsWith('\n');
  }
  return true;
}

/** Posição no texto → índice do pedaço que começa ali (ou do próximo). */
const tokAt = (toks: LiquidToken[], pos: number) => {
  const i = toks.findIndex((t) => t.start >= pos);
  return i < 0 ? toks.length : i;
};

/** Trecho de uma linha de saída: a saída e a quebra depois dela (se a linha for só dela). */
function outputLine(src: string, toks: LiquidToken[], i: number): [number, number] {
  const t = toks[i]!;
  let end = t.end;
  if (atLineStart(src, toks, i)) {
    const m = /^[ \t]*\r?\n/.exec(src.slice(end));
    if (m) end += m[0].length;
  }
  return [t.start, end];
}

/** Junta trechos que se encostam ou se sobrepõem e apaga do fim para o começo. */
function cut(src: string, spans: [number, number][]) {
  const sorted = [...spans].sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const s of sorted) {
    const last = merged.at(-1);
    if (last && s[0] < last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  let out = src;
  for (const [a, b] of merged.reverse()) {
    let end = b;
    // Bloco inteiro numa linha só dele: leva a quebra junto (não sobra linha em branco).
    if ((a === 0 || out[a - 1] === '\n') && out[end] === '\n' && out[end - 1] !== '\n') end++;
    out = out.slice(0, a) + out.slice(end);
  }
  return out;
}

/** Tira as linhas que mostram o dado (e o {% if %} ou {% for %} que só existe por causa dele). */
export function removeData(src: string, name: string): string {
  const re = varPattern(name);
  if (!re) throw new ActionError('Diga qual dado tirar (ex.: "pedido.cpf_cnpj").');
  const toks = scanLiquid(src);
  const blocks = liquidBlocks(toks);
  const spanOf = (b: LiquidBlock): [number, number] => [toks[b.open]!.start, toks[b.close]!.end];
  const gated = blocks.filter(
    (b) =>
      (b.name === 'for' || ((b.name === 'if' || b.name === 'unless') && !b.branches.length)) &&
      re.test(code(toks[b.open]!.args ?? '')),
  );
  const spans = gated.map(spanOf);
  const inside = (pos: number) => spans.some(([a, z]) => pos >= a && pos < z);
  toks.forEach((t, i) => {
    if (t.kind !== 'out' || !re.test(code(t.inner)) || inside(t.start)) return;
    spans.push(outputLine(src, toks, i));
  });
  if (!spans.length) {
    const inCond = toks.some((t) => t.kind === 'tag' && re.test(code(t.args ?? '')));
    throw new ActionError(
      inCond
        ? `O dado "${name}" só aparece numa condição com "senão" (else). Use a ação trocar para mudar esse trecho.`
        : `O dado "${name}" não aparece neste modelo. Veja em "O que o papel mostra hoje" os nomes que existem.`,
    );
  }
  return cut(src, spans);
}

/** Tira as linhas com esse texto fixo (ex.: "NÃO É DOCUMENTO FISCAL"). */
export function removeText(src: string, text: string): string {
  const want = fold(text.replace(/^["']|["']$/g, '')).replace(/\s+/g, ' ');
  if (!want) throw new ActionError('Diga qual texto tirar.');
  const toks = scanLiquid(src);
  const spans: [number, number][] = [];
  toks.forEach((t, i) => {
    if (t.kind !== 'out') return;
    const literals = [...t.inner.matchAll(QUOTED)].map((m) =>
      fold(m[0].slice(1, -1).replace(/\\(.)/g, '$1')).replace(/\s+/g, ' '),
    );
    if (literals.some((l) => l.trim() && l.includes(want))) spans.push(outputLine(src, toks, i));
  });
  if (!spans.length)
    throw new ActionError(
      `O texto "${text}" não aparece neste modelo. Para tirar um dado (cliente, CPF…), use "remover" com "dado".`,
    );
  return cut(src, spans);
}

/** "texto" do Liquid, com \ e aspas escapados; sem marcas @@ nem chaves do Liquid. */
export function liquidString(text: string) {
  const clean = text
    .replace(/@@/g, '@')
    .replace(/[{}]/g, '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ');
  return `"${clean.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Linha(s) de texto fixo no estilo pedido. */
export function textLines(
  text: string,
  style: 'normal' | 'negrito' | 'grande',
  align: 'centro' | 'esquerda',
) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const lit = liquidString(l);
      if (style === 'grande')
        return align === 'centro' ? `{{ ${lit} | grande: "centro" }}` : `{{ ${lit} | grande }}`;
      const chain = align === 'centro' ? `${lit} | quebra | centro` : `${lit} | quebra`;
      return `{{ ${chain}${style === 'negrito' ? ' | negrito' : ''} }}`;
    })
    .join('\n');
}

/** Põe linhas no lugar certo, com a quebra de linha que faltar antes. */
function insertAt(src: string, pos: number, lines: string) {
  const toks = scanLiquid(src);
  const before = atLineStart(src, toks, tokAt(toks, pos)) ? '' : '\n';
  const after = pos >= src.length ? '' : '\n';
  return `${src.slice(0, pos)}${before}${lines}${after}${src.slice(pos)}`;
}

/** Onde entra o texto: no fim, antes do último traço; no começo, logo depois da logo. */
export function addText(
  src: string,
  text: string,
  where: 'fim' | 'comeco',
  style: 'normal' | 'negrito' | 'grande',
  align: 'centro' | 'esquerda',
) {
  const lines = textLines(text, style, align);
  if (!lines) throw new ActionError('O texto para pôr no papel veio vazio.');
  const toks = scanLiquid(src);
  if (where === 'comeco') {
    const logo = liquidBlocks(toks).find(
      (b) => b.name === 'if' && /(^|\W)loja\.logo(\W|$)/.test(toks[b.open]!.args ?? ''),
    );
    const first = toks.find((t) => t.kind !== 'text' || t.inner.trim());
    const pos = logo && first && toks.indexOf(first) === logo.open ? toks[logo.close]!.end : 0;
    return insertAt(src, pos, lines);
  }
  const outs = toks.filter((t) => t.kind === 'out');
  const last = outs.at(-1);
  if (last && /\|\s*traco\b/.test(last.inner) && !src.slice(last.end).trim())
    return insertAt(src, last.start, lines);
  const trimmed = src.replace(/\s+$/, '');
  return insertAt(trimmed, trimmed.length, lines) + '\n';
}

const LOGO_BLOCK = '{% if loja.logo %}{{ loja.logo }}\n{% endif %}';

/** Acha o trecho no modelo: igual, ou igual tirando a diferença de espaços. */
export function findSnippet(src: string, snippet: string): [number, number] {
  const want = snippet.replace(/\r/g, '');
  const exact: number[] = [];
  for (let at = src.indexOf(want); at >= 0; at = src.indexOf(want, at + 1)) exact.push(at);
  if (exact.length === 1) return [exact[0]!, exact[0]! + want.length];
  if (exact.length > 1)
    throw new ActionError(
      `O trecho "${short(want)}" aparece ${exact.length} vezes no modelo. Mande um trecho maior, que apareça uma vez só.`,
    );
  // Mesmos pedaços, espaços diferentes ({{x|centro}} = {{ x | centro }}); texto entre aspas igual.
  const atoms = want.match(
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\{\{|\}\}|\{%|%\}|[|:,]|[^\s|:,"'{}%]+|[{}%"']/g,
  );
  if (atoms?.length) {
    const re = new RegExp(
      atoms.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'),
      'g',
    );
    const hits = [...src.matchAll(re)];
    if (hits.length === 1) return [hits[0]!.index!, hits[0]!.index! + hits[0]![0].length];
    if (hits.length > 1)
      throw new ActionError(
        `O trecho "${short(want)}" aparece ${hits.length} vezes no modelo. Mande um trecho maior, que apareça uma vez só.`,
      );
  }
  throw new ActionError(
    `Não achei este trecho no modelo atual: "${short(want)}". Copie o "de" exatamente do modelo que está no editor.`,
  );
}

const short = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}...` : s).replace(/\n/g, '\\n');

/** Aplica uma ação e devolve o modelo novo e o que mudou (frase curta). */
function applyOne(src: string, kind: TemplateKind, a: TemplateAction): [string, string] {
  switch (a.tipo) {
    case 'adicionar_texto':
      return [
        addText(src, a.texto, a.onde, a.estilo, a.alinhar),
        `Texto ${a.onde === 'fim' ? 'no fim' : 'no começo'}: ${a.texto.replace(/\n/g, ' / ')}`,
      ];
    case 'remover':
      return a.dado
        ? [removeData(src, a.dado), `Tirou ${a.dado}`]
        : [removeText(src, a.texto!), `Tirou "${a.texto}"`];
    case 'logo': {
      const has = varPattern('loja.logo')!.test(code(src));
      if (!a.ligar) {
        if (!has) throw new ActionError('Este modelo já está sem a logo.');
        return [removeData(src, 'loja.logo'), 'Tirou a logo'];
      }
      if (kind === 'fiscal_footer')
        throw new ActionError(
          'O rodapé do cupom fiscal não leva logo (o cupom da NFC-e tem o cabeçalho próprio). Ofereça um texto.',
        );
      if (has)
        throw new ActionError(
          'A logo já está no modelo. Se ela não sai no papel, a logo precisa estar cadastrada em Loja online.',
        );
      return [LOGO_BLOCK + src.replace(/^\s+/, ''), 'Pôs a logo no topo'];
    }
    case 'trocar': {
      const [from, to] = findSnippet(src, a.de);
      return [src.slice(0, from) + a.para.replace(/\r/g, '') + src.slice(to), 'Trocou um trecho'];
    }
    case 'padrao':
      return [DEFAULT_TEMPLATES[kind], 'Voltou ao modelo padrão'];
    case 'reescrever':
      return [a.modelo.replace(/\r/g, ''), 'Reescreveu o modelo'];
  }
}

/**
 * Aplica as ações em ordem (cada uma no resultado da anterior). Lança ActionError dizendo qual
 * ação falhou e por quê. Ações que não mudam nada também são erro: a resposta diria que mudou.
 */
export function applyActions(body: string, kind: TemplateKind, actions: TemplateAction[]) {
  let out = body.replace(/\r/g, '');
  const done: string[] = [];
  actions.forEach((a, i) => {
    try {
      const [next, what] = applyOne(out, kind, a);
      out = next;
      done.push(what);
    } catch (e) {
      if (e instanceof ActionError)
        throw new ActionError(
          actions.length > 1 ? `Ação ${i + 1} (${a.tipo}): ${e.message}` : e.message,
        );
      throw e;
    }
  });
  if (actions.length && out === body.replace(/\r/g, ''))
    throw new ActionError('As ações não mudaram nada no modelo. Confira o modelo atual.');
  if (out.length > TEMPLATE_MAX)
    throw new ActionError(`O modelo ficaria com mais de ${TEMPLATE_MAX} caracteres.`);
  return { body: out, done };
}
