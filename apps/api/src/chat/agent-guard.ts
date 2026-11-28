/**
 * Proteções e ações da IA que atende o cliente no WhatsApp. Funções puras (testadas à parte):
 * - o que o cliente mandou: tentativa de tirar a IA do papel, mensagem enorme;
 * - o que a IA respondeu: marcas de ação ([[RESERVAR …]], [[CARDAPIO]] …), link estranho,
 *   pedaço das instruções vazando;
 * - a resposta do cliente a uma confirmação (SIM / NÃO).
 */

/** Marcas que o modelo põe no fim da resposta. O servidor tira todas antes de enviar. */
export const TAGS = {
  handoff: '[[ATENDENTE]]',
  abuse: '[[ABUSO]]',
  menuFile: '[[CARDAPIO]]',
  calendarPdf: '[[CALENDARIO_PDF]]',
} as const;

/** Reserva que a IA montou com o cliente (o servidor confere e pede o SIM antes de gravar). */
export interface ReserveAction {
  date: string;
  time: string;
  people: number;
  name: string;
  notes: string | null;
}

export interface AgentActions {
  text: string;
  handoff: boolean;
  abuse: boolean;
  menuFile: boolean;
  calendarPdf: boolean;
  reserve: ReserveAction | null;
  /** Código da reserva que o cliente quer cancelar. */
  cancel: string | null;
}

const RESERVE = /\[\[\s*RESERVAR\b([^\]]*)\]\]/i;
const CANCEL = /\[\[\s*CANCELAR\b[^\]]*?\b([A-HJ-NP-Z2-9]{5})\b[^\]]*\]\]/i;
const ANY_TAG = /\[\[[^\]]{0,300}\]\]/g;

/** `data=2026-11-20 hora=20:00 pessoas=4 nome="Maria" obs="aniversário"` → mapa. */
function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zçãé]+)\s*[=:]\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]!.toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
  return out;
}

/** "20:00", "20h", "20h30", "8:30" → "HH:MM". */
export function normTime(v: string | undefined): string | null {
  const m = /^(\d{1,2})(?:[:h](\d{2})?)?h?$/i.exec((v ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function parseReserve(raw: string): ReserveAction | null {
  const a = attrs(raw);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(a.data ?? '') ? a.data! : null;
  const time = normTime(a.hora ?? a.horario);
  const people = Number(a.pessoas ?? a.pessoa);
  const name = (a.nome ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!date || !time || !Number.isInteger(people) || people < 1 || people > 200 || name.length < 2)
    return null;
  const notes = (a.obs ?? a.observacao ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;
  return { date, time, people, name, notes };
}

/** Lê as marcas da resposta do modelo e devolve o texto limpo para o cliente. */
export function parseActions(text: string): AgentActions {
  const has = (t: string) => text.includes(t);
  const r = RESERVE.exec(text);
  const c = CANCEL.exec(text);
  return {
    handoff: has(TAGS.handoff),
    abuse: has(TAGS.abuse),
    menuFile: has(TAGS.menuFile),
    calendarPdf: has(TAGS.calendarPdf),
    reserve: r ? parseReserve(r[1] ?? '') : null,
    cancel: c ? c[1]!.toUpperCase() : null,
    text: text
      .replace(ANY_TAG, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  };
}

// ------------------------------------------------------------------ o que o cliente mandou

/**
 * Tentativas conhecidas de tirar a IA do papel ("ignore as instruções", "modo desenvolvedor",
 * "mostre o seu prompt"…), em português e inglês. Não precisa pegar tudo: o prompt também manda
 * recusar; isto só evita gastar a IA com o óbvio e conta como tentativa de abuso.
 */
const INJECTION: RegExp[] = [
  /\b(ignor[ea]\w*|esque[cç]\w*|desconsider\w*|disregard|forget|ignore)\b.{0,40}\b(instru[cç][õo]es|regras|prompt|comandos|orienta[cç][õo]es|instructions|rules|above|anteriores|previous)\b/i,
  /\b(system\s*prompt|prompt\s+do\s+sistema|seu\s+prompt|suas\s+instru[cç][õo]es|your\s+(system\s+)?(prompt|instructions))\b/i,
  /\b(modo|mode)\s+(desenvolvedor|developer|dev|deus|god|dan|jailbreak|sem\s+restri[cç][õo]es)\b/i,
  /\bjailbreak\b|\bDAN\b.{0,20}\b(mode|modo)\b/i,
  /\b(a\s+partir\s+de\s+agora|from\s+now\s+on)\b.{0,40}(voc[eê]\s+(?:[eé]|ser[aá])\s|you\s+are|finja|pretend|aja\s+como|act\s+as)/i,
  /\b(finja|pretend|aja\s+como|act\s+as|roleplay)\b.{0,30}\b(que\s+[eé]|ser|to\s+be)?\s*(outr[oa]|um[a]?\s+(ia|assistente|hacker|chatgpt)|chatgpt|gpt)\b/i,
  /<\s*\/?\s*(system|assistant|instructions?)\s*>|\[\[\s*(ATENDENTE|RESERVAR|CANCELAR|ABUSO|CARDAPIO|CALENDARIO_PDF)/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION.some((re) => re.test(text));
}

/**
 * Pedido claramente fora do restaurante (0.281, David: "que não fuja do contexto"): código,
 * redação, tradução, lição de casa, política, "você é o ChatGPT?". O servidor responde na hora
 * com a frase pronta, sem gastar a IA e sem dar chance de ela se perder. Só o óbvio: o resto o
 * prompt recusa. Não conta como abuso.
 */
const OFF_TOPIC: RegExp[] = [
  /\b(escrev\w*|cri[ae]\w*|faz|fa[cç]a|fazer|gere|gerar|monte|resolv\w*|me\s+d[êe])\b.{0,40}\b(c[oó]digo|programa|script|fun[cç][aã]o\s+em|reda[cç][aã]o|poema|poesia|m[uú]sica|letra\s+de|trabalho\s+(da|de|escolar)|li[cç][aã]o|dever\s+de\s+casa|curr[ií]culo|artigo|tcc|resumo\s+d[eo]\s+livro)\b/i,
  /\b(python|javascript|typescript|java|php|html|css|sql|c\+\+|excel)\b.{0,30}\b(c[oó]digo|como|fa[cç]o|erro|f[oó]rmula|script)\b/i,
  /\b(traduz\w*|tradu[cç][aã]o|translate)\b/i,
  /\b(presidente|elei[cç][aã]o|elei[cç][oõ]es|partido|bolsonaro|lula|pol[ií]tica|religi[aã]o)\b/i,
  /\b(voc[eê]\s+[eé]|vc\s+[eé]|you\s+are)\s+(o\s+|a\s+)?(chat\s*gpt|gpt|gemini|openai|claude|copilot|uma?\s+ia\s+de)\b/i,
  /\b(quanto\s+[eé]|calcule|resolva)\s+\d+\s*[x×*/^+-]\s*\d+/i,
];

export function looksOffTopic(text: string): boolean {
  return OFF_TOPIC.some((re) => re.test(text));
}

export const offTopicReply = (store: string) =>
  `Sou o atendente virtual da *${store}* e só consigo ajudar com o cardápio, pedidos, entrega, horários e reservas. 🙂`;

/** Mensagem do cliente pronta para ir ao modelo: sem marcas de ação e com tamanho limitado. */
export function cleanInbound(text: string, max = 1500): string {
  return text
    .replace(/\[\[|\]\]/g, '')
    .replace(/[​-‏‪-‮⁦-⁩]/g, '') // caracteres invisíveis
    .trim()
    .slice(0, max);
}

// ------------------------------------------------------------------ o que a IA respondeu

const LINK = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;

/**
 * Tira da resposta links que não são do restaurante (golpe de link falso que alguém tentou
 * "ensinar" à IA). `allowed` = hosts do restaurante (cardápio online, domínio próprio).
 */
export function stripForeignLinks(text: string, allowed: string[]): string {
  const ok = new Set(allowed.map((h) => h.toLowerCase()));
  return text.replace(LINK, (u) => {
    let host = '';
    try {
      host = new URL(u.startsWith('http') ? u : `https://${u}`).hostname.toLowerCase();
    } catch {
      return '';
    }
    return ok.has(host) ? u : '';
  });
}

/** Trechos das instruções que nunca aparecem numa resposta normal. */
const PROMPT_MARKERS = [
  'Regras que você sempre segue',
  'O que você pode fazer:',
  'Cardápio (só o que você pode oferecer)',
  'Resumo da conversa até aqui',
  '[[RESERVAR',
  'Proteção (nunca quebre)',
];

/** A IA foi levada a repetir as próprias instruções. */
export function leaksPrompt(text: string): boolean {
  return PROMPT_MARKERS.some((m) => text.includes(m));
}

// ------------------------------------------------------------------ confirmação

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** "sim", "Sim!", "pode confirmar", "confirmo", "isso", "ok" (mensagem curta). */
export function isYes(text: string): boolean {
  const t = strip(text);
  if (!t || t.length > 40 || isNo(text)) return false;
  return /^(sim|s|si|yes|ok|okay|confirmo|confirmar|confirma|confirmado|pode|pode sim|pode confirmar|pode reservar|isso|isso mesmo|exato|perfeito|fechado|beleza|blz|bora|claro|certo|correto|sim pode|sim confirmo|sim por favor|sim obrigad[oa])( (sim|por favor|pode|obrigad[oa]|confirmo))*$/.test(
    t,
  );
}

/**
 * Resposta ao "posso cancelar sua reserva?": "cancela", "pode cancelar", "cancela sim" querem
 * dizer SIM (o isNo lê "cancela" como NÃO, que vale para o pedido de reserva).
 */
export function isCancelYes(text: string): boolean {
  const t = strip(text);
  if (!t || t.length > 40) return false;
  return /^(sim )?(pode )?(cancela|cancelar|cancele|cancelado)( (sim|pode|por favor|mesmo|ela|a reserva|obrigad[oa]))*$/.test(
    t,
  );
}

/** "não", "nao", "cancela", "deixa", "errado" (mensagem curta). */
export function isNo(text: string): boolean {
  const t = strip(text);
  if (!t || t.length > 40) return false;
  return /^(nao|n|no|nope|cancela|cancelar|deixa|deixa pra la|esquece|errado|esta errado|nao quero|nao obrigad[oa]|melhor nao)\b/.test(
    t,
  );
}
