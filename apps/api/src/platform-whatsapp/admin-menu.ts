/**
 * Menu do Super Admin pelo WhatsApp: partes puras (sem banco), testadas em admin-menu.test.ts.
 * Texto do WhatsApp: *negrito*, _itálico_, uma opção por linha, número na frente.
 */

/** Telas do menu. `tenant` = um restaurante escolhido. */
export type Screen = 'main' | 'pick' | 'tenant' | 'backups' | 'alerts';

/** Ações que mudam alguma coisa: só rodam depois do SIM. */
export type PendingAction = 'backup' | 'restore_test' | 'clear_cache';

/** Sem resposta por esse tempo, o menu volta ao começo (e esquece a ação esperando o SIM). */
export const STATE_TTL_MS = 30 * 60_000;

/** Quantos restaurantes aparecem numa lista para escolher. */
export const PICK_LIMIT = 12;

/** Texto como a pessoa digitou → comparação sem acento, caixa e pontuação nas pontas. */
export function normalizeInput(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.!?,;:]+|[.!?,;:]+$/g, '');
}

const YES = new Set(['sim', 's', 'confirmo', 'confirmar', 'pode', 'ok', 'yes']);
export const isYes = (t: string) => YES.has(t);

/** Palavras que sempre levam ao menu principal, de qualquer tela. */
const HOME = new Set(['menu', 'inicio', 'oi', 'ola', 'comecar', 'voltar', 'principal', 'admin']);
export const isHome = (t: string) => HOME.has(t);
export const isHelp = (t: string) => t === 'ajuda' || t === '?' || t === 'help';

/** "3", "3.", "opção 3" → 3. Outra coisa → null. */
export function optionOf(t: string): number | null {
  const m = /^(?:opcao\s*)?(\d{1,2})$/.exec(t);
  return m ? Number(m[1]) : null;
}

/**
 * Chave do telefone para comparar números: DDD + 8 últimos dígitos (o WhatsApp às vezes guarda o
 * número antigo sem o 9, e o cadastro pode vir com ou sem 55). Mesma regra do KEY_SQL do serviço.
 */
export function phoneKey(d: string | null | undefined): string | null {
  const s = (d ?? '').replace(/\D/g, '');
  if (s.length < 10) return null;
  const ddd = s.length >= 12 && s.startsWith('55') ? s.slice(2, 4) : s.slice(0, 2);
  return ddd + s.slice(-8);
}

/* ------------------------------------------------------------------ formatos */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (v: number | string | null | undefined) => BRL.format(Number(v ?? 0));
export const int = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString('pt-BR');

export function bytes(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v < 1024) return `${v} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toLocaleString('pt-BR', { maximumFractionDigits: x < 10 ? 1 : 0 })} ${u[i]}`;
}

/** "há 5 min", "há 3 h", "há 2 dias"; futuro: "em 3 dias". */
export function ago(at: Date | string | null | undefined, now = new Date()): string {
  if (!at) return 'nunca';
  const ms = now.getTime() - new Date(at).getTime();
  const future = ms < 0;
  const m = Math.round(Math.abs(ms) / 60_000);
  const txt =
    m < 1
      ? 'agora'
      : m < 60
        ? `${m} min`
        : m < 48 * 60
          ? `${Math.round(m / 60)} h`
          : `${Math.round(m / 1440)} dias`;
  if (txt === 'agora') return 'agora';
  return future ? `em ${txt}` : `há ${txt}`;
}

/** 24/11 18:30 no horário de Brasília (o painel é de um dono no Brasil). */
export function when(at: Date | string | null | undefined, tz = 'America/Sao_Paulo'): string {
  if (!at) return '—';
  return new Date(at).toLocaleString('pt-BR', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Hora e dia de agora em Brasília: o resumo do dia sai na hora escolhida, nesse fuso. */
export function brasiliaNow(now = new Date()): { hour: number; day: string } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return { hour: Number(get('hour')), day: `${get('year')}-${get('month')}-${get('day')}` };
}

export const TENANT_STATUS: Record<string, string> = {
  requested: 'pedido',
  provisioning: 'sendo criado',
  provisioned: 'no ar',
  failed: 'falhou ao criar',
  recovering: 'recuperando',
  suspended: 'suspenso',
  moving: 'mudando de banco',
  deleting: 'sendo excluído',
  migrated: 'foi para outro servidor',
};

export const SUB_STATUS: Record<string, string> = {
  trialing: 'teste grátis',
  active: 'em dia',
  past_due: 'em atraso',
  cancelled: 'cancelada',
};

export const CHECK: Record<string, string> = {
  ok: '✅ ok',
  error: '🔴 fora do ar',
  disabled: '⚪ não configurado',
};

/** Ícone por gravidade (lista de varredura e alertas). */
export const ICON = { ok: '✅', warn: '⚠️', bad: '🔴', info: 'ℹ️' } as const;
export type Level = keyof typeof ICON;
export interface Finding {
  level: Level;
  text: string;
}

/** Lista de achados → texto, com os problemas primeiro. */
export function findingsText(list: Finding[]): string {
  const order: Level[] = ['bad', 'warn', 'info', 'ok'];
  return [...list]
    .sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level))
    .map((f) => `${ICON[f.level]} ${f.text}`)
    .join('\n');
}

/** Resumo de uma varredura: "2 problemas, 1 atenção" ou "tudo certo". */
export function findingsHeadline(list: Finding[]): string {
  const bad = list.filter((f) => f.level === 'bad').length;
  const warn = list.filter((f) => f.level === 'warn').length;
  if (!bad && !warn) return '✅ Tudo certo';
  const parts: string[] = [];
  if (bad) parts.push(`🔴 ${bad} ${bad === 1 ? 'problema' : 'problemas'}`);
  if (warn) parts.push(`⚠️ ${warn} ${warn === 1 ? 'ponto de atenção' : 'pontos de atenção'}`);
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ telas */

export const FOOTER_MAIN = '_0 = menu · ajuda = comandos_';

export function mainMenu(name: string, tenant: string | null): string {
  return [
    `*Comandou · Super Admin*`,
    `Olá, ${name.split(' ')[0]}! O que você quer ver?`,
    '',
    '1. Resumo do sistema',
    '2. Escolher um restaurante',
    '3. Saúde do servidor',
    '4. Problemas agora (varredura geral)',
    '5. Backups',
    '6. Bancos e servidores',
    '7. Restaurantes novos e testes grátis',
    '8. Cobrança (atrasos e vencimentos)',
    '9. Meus avisos (ligar/desligar)',
    ...(tenant ? ['', `Último restaurante: *${tenant}* (responda *r* para voltar a ele)`] : []),
    '',
    '_Digite o número da opção, ou o nome de um restaurante para buscar._',
  ].join('\n');
}

export function tenantMenu(t: { name: string; slug: string; status: string }): string {
  return [
    `*${t.name}* (${t.slug}) · ${TENANT_STATUS[t.status] ?? t.status}`,
    '',
    '1. Visão geral (plano, assinatura, versão, banco)',
    '2. Movimento dos últimos 30 dias',
    '3. Varredura completa deste restaurante',
    '4. Equipe e acessos',
    '5. Histórico do painel',
    '6. Banco de dados e backup',
    '7. Limpar cache do restaurante',
    '',
    '8. Trocar de restaurante',
    '0. Menu principal',
  ].join('\n');
}

export function pickList(
  title: string,
  items: { name: string; slug: string; status: string }[],
): string {
  if (!items.length)
    return [
      title,
      '',
      'Nenhum restaurante encontrado. Digite outra parte do nome, ou *0* para o menu.',
    ].join('\n');
  return [
    title,
    '',
    ...items.map(
      (t, i) =>
        `${i + 1}. ${t.name} (${t.slug})${t.status === 'provisioned' ? '' : ` · ${TENANT_STATUS[t.status] ?? t.status}`}`,
    ),
    '',
    '_Responda o número, ou digite parte do nome para buscar. 0 = menu._',
  ].join('\n');
}

export const HELP = [
  '*Como usar o menu*',
  '',
  '• Responda o *número* da opção.',
  '• Digite o *nome* (ou parte) de um restaurante para abrir direto.',
  '• *menu* ou *0*: volta ao começo.',
  '• *r*: volta ao último restaurante.',
  '• Ações que mudam algo (backup agora, limpar cache) pedem *SIM* antes.',
  '',
  'Os avisos automáticos (backup que falhou, restaurante novo, banco que não ficou pronto, serviço fora do ar) e o resumo do dia chegam sozinhos aqui. Para ligar ou desligar: opção *9* do menu.',
].join('\n');

export const CONFIRM: Record<PendingAction, string> = {
  backup: 'Fazer um *backup agora* do banco central? Responda *SIM* para confirmar.',
  restore_test:
    'Rodar o *teste de restauração* agora (restaura o último backup num banco à parte e confere)? Responda *SIM*.',
  clear_cache:
    'Limpar o cache deste restaurante? Todas as telas abertas dele recarregam do servidor. Responda *SIM* para confirmar.',
};

/** Mensagem longa é cortada no limite da conversa do painel (4000), com aviso. */
export function clip(text: string, max = 3900): string {
  return text.length <= max ? text : `${text.slice(0, max - 40).trimEnd()}\n\n_(lista cortada)_`;
}
