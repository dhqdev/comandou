/** Tipos da aba E-mail do Super Admin (espelham apps/api/src/mail). */

export type Folder = 'inbox' | 'sent' | 'drafts' | 'archive' | 'spam' | 'trash';
export type FolderView = Folder | 'starred';

export interface Address {
  email: string;
  name?: string;
}

export interface MailSettings {
  provider: 'none' | 'cloudflare' | 'resend' | 'smtp';
  fromAddress: string;
  fromName: string;
  replyTo: string;
  cfAccountId: string;
  cfTokenSet: boolean;
  resendKeySet: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassSet: boolean;
  inboundSecretSet: boolean;
  ready: boolean;
  canStoreSecrets: boolean;
}

export interface Domain {
  id: string;
  domain: string;
  mailboxes: number;
}

export interface Mailbox {
  id: string;
  domainId: string;
  address: string;
  displayName: string;
  signature: string;
  catchAll: boolean;
  autoReply: boolean;
  autoReplySubject: string;
  autoReplyBody: string;
  forwardTo: string;
  archived: boolean;
  folders: Record<Folder, { unread: number; total: number }>;
}

export interface Overview {
  settings: MailSettings;
  domains: Domain[];
  mailboxes: Mailbox[];
}

export interface ThreadRow {
  id: string;
  threadId: string;
  direction: 'in' | 'out';
  folder: Folder;
  sendStatus: string | null;
  from: Address;
  to: Address[];
  subject: string;
  snippet: string;
  at: string;
  attachments: boolean;
  count: number;
  unread: boolean;
  starred: boolean;
}

export interface Attachment {
  id: string;
  filename: string;
  type: string;
  size: number;
  inline: boolean;
}

export interface Message {
  id: string;
  direction: 'in' | 'out';
  folder: Folder;
  sendStatus: string | null;
  sendError: string | null;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: string;
  subject: string;
  text: string;
  hasHtml: boolean;
  remoteImages: boolean;
  auth: { spf: string; dkim: string; dmarc: string } | null;
  starred: boolean;
  at: string;
  attachments: Attachment[];
}

export interface Thread {
  threadId: string;
  subject: string;
  messages: Message[];
}

export interface Draft {
  id: string;
  mailboxId: string;
  threadId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  text: string;
  attachments: { id: string; filename: string; size: number }[];
}

export interface Rule {
  id: string;
  mailboxId: string | null;
  name: string;
  enabled: boolean;
  field: 'from' | 'to' | 'subject';
  op: 'contains' | 'equals' | 'ends_with';
  value: string;
  action: 'archive' | 'spam' | 'trash' | 'star' | 'read' | 'reject';
}

export interface Contact {
  id: string;
  email: string;
  name: string;
  company: string;
  phone: string;
  notes: string;
  auto: boolean;
  lastUsedAt: string;
}

export interface Attendee {
  email: string;
  name?: string;
  status: 'needs-action' | 'accepted' | 'declined' | 'tentative';
}

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface CalendarEvent {
  id: string;
  mailboxId: string | null;
  bookingPageId: string | null;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  seriesStartsAt: string;
  seriesEndsAt: string;
  allDay: boolean;
  timeZone: string;
  color: 'brand' | 'blue' | 'green' | 'purple' | 'gray';
  repeat: Repeat;
  repeatUntil: string | null;
  attendees: Attendee[];
}

export interface BookingPage {
  id: string;
  slug: string;
  title: string;
  description: string;
  location: string;
  durationMin: number;
  bufferMin: number;
  minNoticeHours: number;
  daysAhead: number;
  availability: Record<string, [string, string][]>;
  timeZone: string;
  mailboxId: string | null;
  enabled: boolean;
}

export interface OutboxRow {
  id: string;
  kind: string;
  subject: string;
  to: Address[];
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';
  attempts: number;
  lastError: string | null;
  provider: string | null;
  createdAt: string;
  sentAt: string | null;
  nextAttemptAt: string;
  tenant: string | null;
  fromAddress: string;
}

export const FOLDER_LABEL: Record<FolderView, string> = {
  inbox: 'Entrada',
  starred: 'Com estrela',
  sent: 'Enviados',
  drafts: 'Rascunhos',
  archive: 'Arquivo',
  spam: 'Spam',
  trash: 'Lixeira',
};

export const KIND_LABEL: Record<string, string> = {
  'trial.welcome': 'Boas-vindas do teste',
  'trial.test': 'Teste: boas-vindas',
  'customer.password_reset': 'Código de nova senha',
  'customer.test': 'Teste: código de senha',
  'contract.send': 'Contrato para assinar',
  'contract.client_signed': 'Contrato: cliente assinou',
  'contract.signed': 'Contrato assinado',
  'contract.cancelled': 'Contrato cancelado',
  test: 'Teste do envio',
  mailbox: 'Caixa de e-mail',
  'mailbox.auto_reply': 'Resposta automática',
  'calendar.invite': 'Convite da agenda',
  'calendar.cancel': 'Cancelamento da agenda',
  'calendar.booking': 'Novo agendamento',
};

export const fmtSize = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`;

export const who = (a: Address) => a.name || a.email;

/** "14:05" hoje, "ontem", "12 nov", "12/11/2025". */
export function shortDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'ontem';
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
  return d.toLocaleDateString('pt-BR');
}

export const longDate = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
