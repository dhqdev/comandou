import { FOCUS_TARGETS, focusHref } from './ai-focus';
import { isKnownAppPath, STATIC_ENTRIES, type StaticEntry } from './nav-catalog';

/**
 * Lugares do sistema que o assistente de IA da equipe sabe abrir (0.270, pedido do David: "quando
 * eu pergunto onde fica, quero que ele mande o link e, ao clicar, me leve lá"). Junta as telas,
 * seções e atalhos da busca do topo (`STATIC_ENTRIES`) com os campos e botões que piscam
 * (`FOCUS_TARGETS`). A API e a tela usam as mesmas funções:
 *
 * - `placeFor("Conta › Uso de IA")`: o lugar com esse nome (o que a IA escreve em negrito);
 * - `placesFor(pergunta)`: os lugares que combinam com a pergunta (vão no contexto da IA);
 * - `linkPlaces(resposta)`: põe o link em cada lugar citado em negrito e conserta link com
 *   caminho inventado. O link sai mesmo quando o modelo esquece de escrever (DeepSeek e Gemini
 *   às vezes só põem o nome em negrito).
 */
export interface AppPlace {
  id: string;
  /** Nome curto ("Uso de IA", "Pedido mínimo"). */
  title: string;
  /** Onde fica pelo menu ("Conta › Uso de IA", "Loja online › Pedido mínimo"). */
  where: string;
  /** Link no app; campo e botão vão com `?foco=` (a tela rola até lá e o lugar pisca). */
  path: string;
  /** Basta uma destas permissões. Sem `perms`, todos abrem. */
  perms?: string[];
  /** Para que serve, numa linha (da busca do topo). */
  hint?: string;
  /** Campo ou botão que pisca ao chegar. */
  focus: boolean;
}

/** Quem pergunta abre este lugar? (permissões de quem está usando). */
export type CanOpen = (perms?: string[]) => boolean;

/** Minúsculas, sem acento e só letras e números separados por um espaço. */
export function foldPlace(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Outros nomes do mesmo lugar, do jeito que a equipe (e a IA) fala. Chave = id do lugar.
 * Sem acento e em minúsculas.
 */
const ALIASES: Record<string, string[]> = {
  's-pdv': ['tela inicial', 'ponto de venda'],
  's-salao': ['mesas', 'mapa de mesas', 'mapa do salao'],
  's-cardapio': ['itens do cardapio'],
  's-estoque': ['insumos'],
  's-fiscal': ['nota fiscal', 'notas fiscais', 'nfc e', 'nfce'],
  's-integracoes': ['aplicativos', 'integracoes'],
  's-assistente-ia': ['ia do whatsapp', 'atendimento com ia'],
  's-plano': ['plano', 'mensalidade', 'minha assinatura', 'plano e assinatura'],
  's-uso-ia': ['uso da ia', 'consumo de ia', 'consumo da ia', 'tokens de ia', 'uso de tokens'],
  's-ajustes': ['configuracoes'],
  's-conta': ['minha conta'],
  's-agenda': ['agenda'],
  'c-mesas': ['mesas do salao'],
  'c-aparencia': ['aparencia'],
  'c-destaques': ['destaques'],
  'c-fidelidade': ['fidelidade'],
  'c-cupons': ['cupons'],
  'c-funcionamento': ['funcionamento', 'horarios'],
  'c-producao': ['producao de preparos', 'producao da casa'],
  'c-recebimento': ['recebimento', 'entrada de nota'],
  'c-precificacao': ['custo e preco', 'cmv'],
  'c-fin-visao': ['visao geral'],
  'c-conciliacao': ['conciliacao'],
  'c-fechamentos': ['fechamentos'],
  'c-fila': ['fila de impressoes'],
  'c-agentes': ['computadores de impressao'],
  'c-qr': ['conectar whatsapp', 'qr code', 'qr code do whatsapp'],
  'c-inutilizacao': ['inutilizacao'],
  'botao-loja-aberta': ['loja aberta', 'loja fechada'],
  'botao-sangria': ['sangria', 'suprimento'],
  'botao-novo-item': ['adicionar item', 'novo item'],
  'botao-nova-pessoa': ['adicionar pessoa'],
  'campo-cor-loja': ['cor da loja'],
  'campo-chave-pix': ['chave pix'],
  'secao-pagamentos': ['pagamento online', 'pagamentos online'],
  'campo-csc': ['csc'],
  'secao-modelos': ['modelo de impressao'],
  'secao-mensagens': ['mensagens automaticas'],
  'secao-sem-vinculo': ['itens sem vinculo'],
  'secao-avaliacoes': ['avaliacoes'],
  'conta-inicio': ['primeiros passos'],
  'conta-suporte': ['suporte', 'falar com o suporte', 'falar com o comandou'],
  'conta-tema': ['tema'],
};

/** Nomes que sozinhos querem dizer outra coisa ("produção" da nota, "entrada" do caixa). */
const DENY = new Set(['producao', 'entrada', 'teste', 'pix', 'hoje', 'mesa', 'item', 'itens']);

const LEAD = /^(botao|botoes|campo|campos|interruptor|secao|bloco)\s+(de |do |da |dos |das )?/;

/** "Botão Nova venda (F2)" → "nova venda". */
function nameOf(title: string): string {
  return foldPlace(title.replace(/\([^)]*\)/g, ' '))
    .replace(LEAD, '')
    .trim();
}

/** "Botão Nova venda (F2)" → "Nova venda"; "Campos do CSC da NFC-e (…)" → "CSC da NFC-e". */
function shortTitle(title: string): string {
  const t = title
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/^(Botão|Botões|Campo|Campos|Interruptor)\s+(de |do |da |dos |das )?/i, '')
    .trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "Conta › Uso de IA: quanto…" → "Conta › Uso de IA". */
function hintChain(hint: string | undefined): string | null {
  const m = /^([^:]+›[^:]+):/.exec(hint ?? '');
  return m ? m[1]!.trim() : null;
}

const pathname = (p: string) => p.split(/[?#]/)[0]!;
const rootOf = (p: string) => pathname(p).split('/')[1] ?? '';

interface Built {
  places: AppPlace[];
  /** Nome → lugares (na ordem de preferência: telas, seções, atalhos, campos). */
  byName: Map<string, AppPlace[]>;
  /** Palavras de cada lugar para a busca pela pergunta. */
  words: Map<string, { strong: Set<string>; weak: Set<string>; names: string[] }>;
}

let built: Built | null = null;

const SCREENS = STATIC_ENTRIES.filter((e) => e.group === 'Telas' && e.to && !e.external);

/** A tela de um caminho: a do mesmo caminho, senão a primeira tela da mesma raiz. */
function screenOf(p: string): StaticEntry | undefined {
  return (
    SCREENS.find((s) => pathname(s.to!) === pathname(p)) ??
    SCREENS.find((s) => rootOf(s.to!) === rootOf(p))
  );
}

/** Quem pergunta abre a tela deste caminho? (caminho fora das telas do menu: sim). */
export function pathAllowed(path: string, can: CanOpen): boolean {
  const screen = screenOf(path);
  return !screen || can(screen.perms);
}

function build(): Built {
  if (built) return built;
  const whereOf = (e: StaticEntry | undefined): string => (e ? (hintChain(e.hint) ?? e.title) : '');
  const places: AppPlace[] = [];
  const byName = new Map<string, AppPlace[]>();
  const words: Built['words'] = new Map();
  const add = (p: AppPlace, names: string[], more: string) => {
    // Mesmo caminho (atalho "Novo pedido" e a tela PDV): os nomes vão para o lugar que já existe.
    const place = places.find((x) => x.path === p.path) ?? p;
    if (place === p) places.push(p);
    const w = words.get(place.path) ?? { strong: new Set(), weak: new Set(), names: [] };
    for (const n of new Set(names.map(foldPlace))) {
      if (!n || DENY.has(n) || w.names.includes(n)) continue;
      w.names.push(n);
      byName.set(n, [...(byName.get(n) ?? []), place]);
      for (const x of n.split(' ')) w.strong.add(x);
    }
    for (const x of foldPlace(more).split(' ')) if (x) w.weak.add(x);
    words.set(place.path, w);
  };
  const order: StaticEntry['group'][] = ['Telas', 'Seções', 'Atalhos'];
  for (const g of order)
    for (const e of STATIC_ENTRIES) {
      if (e.group !== g || !e.to || e.external || e.action || !isKnownAppPath(e.to)) continue;
      const screen = screenOf(e.to);
      const chain = hintChain(e.hint);
      const title = shortTitle(e.title);
      const where =
        chain ?? (screen && screen.id !== e.id ? `${whereOf(screen)} › ${title}` : title);
      add(
        { id: e.id, title, where, path: e.to, perms: e.perms, hint: e.hint, focus: false },
        [e.title, nameOf(e.title), where.replace(/›/g, ' '), ...(ALIASES[e.id] ?? [])],
        `${e.hint ?? ''} ${e.words ?? ''}`,
      );
    }
  for (const t of FOCUS_TARGETS) {
    const screen = screenOf(t.path);
    const title = shortTitle(t.title);
    const where = screen ? `${whereOf(screen)} › ${title}` : title;
    add(
      {
        id: t.id,
        title,
        where,
        path: focusHref(t),
        perms: t.perms,
        hint: t.title,
        focus: true,
      },
      [nameOf(t.title), where.replace(/›/g, ' '), ...(ALIASES[t.id] ?? [])],
      t.title,
    );
  }
  built = { places, byName, words };
  return built;
}

/** Todos os lugares que o assistente conhece (para testes e para o mapa do prompt). */
export function appPlaces(): readonly AppPlace[] {
  return build().places;
}

/** Palavras do começo que não fazem parte do nome ("a tela Caixa", "o botão Nova venda"). */
const QUERY_LEAD = /^((a|o|na|no|em) )?((tela|aba|menu|botao|campo|secao) )?((de|do|da) )?/;

/**
 * O lugar com este nome ("Uso de IA", "Conta › Uso de IA", "Gestão › Financeiro › DRE"). Tenta
 * o caminho inteiro, depois o fim dele, depois cada parte do fim para o começo. Só devolve o que
 * quem pergunta pode abrir.
 */
export function placeFor(text: string, can: CanOpen = () => true): AppPlace | null {
  const parts = text
    .split(/\s*(?:›|»|>|→|\|)\s*/)
    .map((p) => foldPlace(p).replace(QUERY_LEAD, '').trim())
    .filter(Boolean);
  if (!parts.length || parts.length > 5) return null;
  const tries: string[] = [];
  for (let i = 0; i < parts.length; i++) tries.push(parts.slice(i).join(' '));
  for (let i = parts.length - 2; i >= 0; i--) tries.push(parts[i]!);
  const { byName } = build();
  for (const name of tries) {
    if (name.length < 2 || name.length > 60) continue;
    const list = byName.get(name);
    if (!list) continue;
    // Achou o lugar mas a pessoa não abre: para aqui (nada de levar à tela de cima, como a Conta
    // no lugar do Uso de IA, que ela não veria lá).
    return list.find((p) => can(p.perms)) ?? null;
  }
  return null;
}

/** Palavras que não ajudam a achar o lugar (sem acento). */
const STOP = new Set(
  `a o as os um uma uns umas de da do das dos em no na nos nas num numa para pra pro por pelo pela
   com sem e ou mas que qual quais quem como onde aonde quando quanto quanta quantos quantas cade
   porque pq se ja nao sim mais menos muito tudo todo toda todos todas algum alguma nenhum outro
   outra isso isto esse essa este esta aquele aquela ai la aqui ali eu voce vc voces me mim meu
   minha meus minhas seu sua seus suas nosso nossa ele ela eles elas oi ola bom boa dia tarde noite
   obrigado obrigada favor fica ficam esta estao estou tem tenho ter ha foi ser sou era to ta faz
   fazer faco consigo consegue posso pode quero queria preciso precisa leva levar leve mostra
   mostrar mostre ver vejo veja abrir abre abro ir vai vou va achar acho acha encontrar encontro
   mudar mudo muda trocar troco alterar altero editar colocar coloco sistema comandou tela telas
   aba abas menu parte lugar link caminho agora hoje certo errado ainda sobre usar usando mesmo`.split(
    /\s+/,
  ),
);
/** Siglas e palavras curtas que importam. */
const SHORT = new Set(['ia', 'qr', 'nf', 'cmv', 'dre', 'pix', 'kds', 'pdv', 'app', 'csc', 'cpf']);

function questionWords(q: string): string[] {
  return [
    ...new Set(
      foldPlace(q)
        .split(' ')
        .filter((w) => w && !STOP.has(w) && (w.length >= 3 || SHORT.has(w))),
    ),
  ];
}

/** Mesma palavra com outro final ("gastando" e "gasto", "nota" e "notas", "pago" e "pagar"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (Math.min(a.length, b.length) === 4 && i === 3) return true;
  return i >= (a.length >= 6 && b.length >= 6 ? 5 : 4);
}

/**
 * Os lugares que combinam com a pergunta, do mais provável ao menos (vão no contexto do
 * assistente, com o link exato). Palavra do nome pesa mais que palavra de apoio; o nome inteiro
 * escrito na pergunta pesa mais ainda. Fica só o que está perto do melhor.
 */
export function placesFor(
  question: string,
  can: CanOpen = () => true,
  limit = 3,
): { place: AppPlace; score: number }[] {
  const qs = questionWords(question);
  if (!qs.length) return [];
  const folded = ` ${foldPlace(question)} `;
  const { places, words } = build();
  const scored: { place: AppPlace; score: number }[] = [];
  for (const p of places) {
    if (!can(p.perms)) continue;
    const w = words.get(p.path)!;
    let score = 0;
    for (const q of qs) {
      if ([...w.strong].some((s) => sameWord(q, s))) score += 3;
      else if ([...w.weak].some((s) => sameWord(q, s))) score += 2;
    }
    if (!score) continue;
    // O nome inteiro escrito na pergunta ("pedido mínimo", "uso da ia"): 2 pontos por palavra.
    const whole = w.names.filter((n) => n.length >= 3 && folded.includes(` ${n} `));
    if (whole.length) score += 2 * Math.max(...whole.map((n) => n.split(' ').length));
    scored.push({ place: p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]?.score ?? 0;
  // Pouca coisa em comum: só vale se for um lugar só com essa nota (senão é chute).
  if (top < 4 && scored.filter((s) => s.score === top).length > 1) return [];
  return scored.filter((s) => s.score >= Math.max(2, top * 0.75)).slice(0, limit);
}

/** Pergunta de "onde fica", "me leva", "como eu faço…": a resposta tem que levar até lá. */
export function isPlaceQuestion(q: string): boolean {
  return /\b(onde|aonde|cade|como|qual (a )?(tela|aba|parte)|que (tela|aba|parte)|em que (tela|aba|parte|lugar)|link|caminho|me (leva|leve|mostra|mostre)|leva (pra|para|ate))\b/.test(
    foldPlace(q),
  );
}

/**
 * Caminho interno seguro ("/caixa", "/fiscal/configuracao?foco=…"); nada de fora, nada que caia
 * em "Página não encontrada". Endereço inteiro do próprio Comandou vira só o caminho.
 */
export function safeAppPath(raw: string, host?: string): string | null {
  let p = raw.trim();
  if (/^https?:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      const h = u.host.toLowerCase();
      if (!(host && h === host.toLowerCase()) && !/(^|\.)comandou\.(com|com\.br|app)$/.test(h))
        return null;
      p = `${u.pathname}${u.search}`;
    } catch {
      return null;
    }
  }
  if (!/^\/(?!\/)[\w\-./?=&%#àáâãçéêíóôõú]*$/i.test(p)) return null;
  if (p.includes('..')) return null;
  return isKnownAppPath(p) ? p : null;
}

const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const TOKEN = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+?)\*\*/g;

/** A resposta já tem link para uma tela do app? */
export function hasAppLink(text: string, host?: string): boolean {
  for (const m of text.matchAll(LINK)) if (safeAppPath(m[2]!, host)) return true;
  return false;
}

/**
 * Põe o link nos lugares citados em negrito ("**Conta › Uso de IA**" → "[Conta › Uso de IA](/conta/uso-ia)")
 * e conserta link com caminho que não existe pelo nome dele ("[Assinatura](/assinatura)" →
 * "/plano"). Cada lugar ganha um botão só (o primeiro), até `max` novos. Só leva aonde quem
 * pergunta pode abrir; o resto fica como estava. Passar o texto de novo não muda nada.
 */
export function linkPlaces(
  text: string,
  can: CanOpen,
  o: { max?: number; host?: string } = {},
): string {
  const max = o.max ?? 5;
  const used = new Set<string>();
  for (const m of text.matchAll(LINK)) {
    const p = safeAppPath(m[2]!, o.host);
    if (p) used.add(p);
  }
  let added = 0;
  const take = (place: AppPlace | null) => {
    if (!place || used.has(place.path)) return null;
    used.add(place.path);
    return place.path;
  };
  const run = (s: string): string =>
    s.replace(TOKEN, (all, label?: string, target?: string, bold?: string) => {
      if (label !== undefined) {
        const ok = safeAppPath(target!, o.host);
        if (ok) return ok === target ? all : `[${label}](${ok})`;
        const to = take(placeFor(label.replace(/\*\*/g, ''), can));
        return to ? `[${label}](${to})` : all;
      }
      if (bold!.includes('](')) return `**${run(bold!)}**`;
      if (added >= max) return all;
      const to = take(placeFor(bold!, can));
      if (!to) return all;
      added += 1;
      return `[${bold}](${to})`;
    });
  return run(text);
}
