/** Tipos da aba E-mail do Super Admin (espelham apps/api/src/mail). */

export interface Address {
  email: string;
  name?: string;
}

export interface MailSettings {
  enabled: boolean;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  resendKeySet: boolean;
  ready: boolean;
  canStoreSecrets: boolean;
}

export interface Overview {
  settings: MailSettings;
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

/** Envios antigos (caixas e agenda, até a versão 0.141) continuam aparecendo com o nome certo. */
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
