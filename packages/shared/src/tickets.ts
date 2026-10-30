/**
 * Chamados dos clientes e a esteira de desenvolvimento do painel Super Admin. Cada etapa tem um
 * agente de IA (OpenRouter) que faz a parte dele e passa adiante. Você aprova o chamado depois
 * da triagem; daí em diante ele anda sozinho até o PR e os testes.
 */
export const TICKET_STAGES = [
  { id: 'inicio', label: 'Início', agent: 'Lia', role: 'Recepção e triagem', color: '#6b8afd' },
  {
    id: 'priorizacao',
    label: 'Priorização',
    agent: 'Bento',
    role: 'Priorização e análise de código',
    color: '#f0a020',
  },
  {
    id: 'desenvolvimento',
    label: 'Desenvolvimento',
    agent: 'Caio',
    role: 'Desenvolvimento',
    color: '#9aa3ae',
  },
  { id: 'code_review', label: 'Code review', agent: 'Vera', role: 'Code review', color: '#2fbf71' },
  { id: 'pr', label: 'PR', agent: 'Paulo', role: 'Pull request', color: '#a78bfa' },
  { id: 'testes', label: 'Testes', agent: 'Íris', role: 'Testes e validação', color: '#5b7cfa' },
  {
    id: 'concluido',
    label: 'Concluído',
    agent: 'Nina',
    role: 'Entrega ao cliente',
    color: '#2fbf71',
  },
] as const;

export type TicketStage = (typeof TICKET_STAGES)[number]['id'];
export const TICKET_STAGE_IDS = TICKET_STAGES.map((s) => s.id) as TicketStage[];

/**
 * running: um agente está trabalhando; approval: esperando você aprovar ou recusar; waiting:
 * esperando você (pendência, teste manual, erro); done/rejected/cancelled: fim.
 */
export type TicketState = 'running' | 'approval' | 'waiting' | 'done' | 'rejected' | 'cancelled';
export type TicketKind = 'bug' | 'improvement' | 'question' | 'other';
export type TicketLevel = 'low' | 'medium' | 'high' | 'critical';

export const TICKET_KINDS: { id: TicketKind; label: string }[] = [
  { id: 'bug', label: 'Algo não funciona' },
  { id: 'improvement', label: 'Sugestão de melhoria' },
  { id: 'question', label: 'Dúvida' },
  { id: 'other', label: 'Outro assunto' },
];

export const TICKET_LEVELS: { id: TicketLevel; label: string }[] = [
  { id: 'low', label: 'Baixa' },
  { id: 'medium', label: 'Média' },
  { id: 'high', label: 'Alta' },
  { id: 'critical', label: 'Crítica' },
];

export const stageInfo = (id: string) => TICKET_STAGES.find((s) => s.id === id) ?? TICKET_STAGES[0];
export const stageIndex = (id: string) => Math.max(0, TICKET_STAGE_IDS.indexOf(id as TicketStage));
export const nextStage = (id: string): TicketStage | null =>
  TICKET_STAGE_IDS[stageIndex(id) + 1] ?? null;
export const levelLabel = (id: string | null | undefined) =>
  TICKET_LEVELS.find((l) => l.id === id)?.label ?? '—';
export const kindLabel = (id: string | null | undefined) =>
  TICKET_KINDS.find((k) => k.id === id)?.label ?? '—';

/** Passos que o cliente vê (mais simples que a esteira). */
export const CLIENT_STEPS = [
  'Recebido',
  'Em análise',
  'Aprovado',
  'Em desenvolvimento',
  'Em testes',
  'Resolvido',
] as const;

/** Em que passo o cliente está e o texto do selo dele. */
export function clientStatus(stage: string, state: TicketState): { step: number; label: string } {
  if (state === 'rejected') return { step: 1, label: 'Não será feito' };
  if (state === 'cancelled') return { step: 1, label: 'Cancelado' };
  if (state === 'done' || stage === 'concluido') return { step: 5, label: 'Resolvido' };
  switch (stage) {
    case 'inicio':
      return { step: 1, label: 'Em análise' };
    case 'priorizacao':
      return { step: 2, label: 'Aprovado, na fila' };
    case 'desenvolvimento':
    case 'code_review':
    case 'pr':
      return { step: 3, label: 'Em desenvolvimento' };
    case 'testes':
      return { step: 4, label: 'Em testes' };
    default:
      return { step: 0, label: 'Recebido' };
  }
}
