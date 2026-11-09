import { isValidCnpj, isValidCpf } from './fiscal';

/**
 * Pix "copia e cola" estático (BR Code, padrão EMV do Banco Central), sem banco nem intermediário:
 * o restaurante informa a chave dele e o cardápio monta o código com o valor do pedido. O cliente
 * paga no app do banco e manda o comprovante; a equipe confere e aprova no PDV.
 */

export const PIX_KEY_TYPES = ['cpf', 'cnpj', 'phone', 'email', 'random'] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

export const PIX_KEY_TYPE_LABELS: Record<PixKeyType, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  phone: 'Celular',
  email: 'E-mail',
  random: 'Chave aleatória',
};

/** Limites do BR Code: nome do recebedor até 25 letras, cidade até 15. */
export const PIX_NAME_MAX = 25;
export const PIX_CITY_MAX = 15;

/** Situação do comprovante de um pedido pago por Pix pelo cardápio. */
export const PIX_RECEIPT_STATUSES = ['waiting', 'submitted', 'approved', 'rejected'] as const;
export type PixReceiptStatus = (typeof PIX_RECEIPT_STATUSES)[number];

export const PIX_RECEIPT_LABELS: Record<PixReceiptStatus, string> = {
  waiting: 'Aguardando comprovante',
  submitted: 'Comprovante',
  approved: 'Pix aprovado',
  rejected: 'Comprovante recusado',
};

const RANDOM_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * Chave no formato que o Pix espera (o que vai no código), ou null se não vale:
 * CPF e CNPJ só dígitos (com dígito verificador certo), celular como +55DDDNÚMERO, e-mail em
 * minúsculas e chave aleatória em minúsculas com hífens.
 */
export function normalizePixKey(type: PixKeyType, raw: string): string | null {
  const v = raw.trim();
  if (type === 'cpf') {
    const d = v.replace(/\D/g, '');
    return d.length === 11 && isValidCpf(d) ? d : null;
  }
  if (type === 'cnpj') {
    const d = v.replace(/\D/g, '');
    return d.length === 14 && isValidCnpj(d) ? d : null;
  }
  if (type === 'phone') {
    let d = v.replace(/\D/g, '');
    // Aceita com ou sem o 55 na frente; celular brasileiro tem DDD + 8 ou 9 dígitos.
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
    if (d.length !== 10 && d.length !== 11) return null;
    if (d[0] === '0' || d[1] === '0') return null;
    return `+55${d}`;
  }
  if (type === 'email') {
    const e = v.toLowerCase();
    return e.length <= 77 && EMAIL.test(e) ? e : null;
  }
  const r = v.toLowerCase();
  return RANDOM_KEY.test(r) ? r : null;
}

/** Chave para mostrar ao cliente (CPF/CNPJ/celular com pontuação). */
export function formatPixKey(type: PixKeyType, key: string): string {
  if (type === 'cpf' && key.length === 11)
    return `${key.slice(0, 3)}.${key.slice(3, 6)}.${key.slice(6, 9)}-${key.slice(9)}`;
  if (type === 'cnpj' && key.length === 14)
    return `${key.slice(0, 2)}.${key.slice(2, 5)}.${key.slice(5, 8)}/${key.slice(8, 12)}-${key.slice(12)}`;
  if (type === 'phone' && key.startsWith('+55')) {
    const d = key.slice(3);
    const head = d.length === 11 ? d.slice(2, 7) : d.slice(2, 6);
    return `(${d.slice(0, 2)}) ${head}-${d.slice(head.length + 2)}`;
  }
  return key;
}

/**
 * Nome e cidade só com letras sem acento, números e espaço (alguns bancos recusam o código com
 * acento), cortados no limite do BR Code.
 */
export function pixText(raw: string, max: number): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** CRC16/CCITT-FALSE (polinômio 0x1021, início 0xFFFF), em 4 dígitos hexadecimais maiúsculos. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const field = (id: string, value: string) =>
  `${id}${String(value.length).padStart(2, '0')}${value}`;

export interface PixPayee {
  key: string;
  name: string;
  city: string;
}

/**
 * Monta o Pix copia e cola. `amount` em reais com ponto ("46.90"); sem valor (ou zero), o cliente
 * digita no banco. O identificador fica "***" (Pix estático sem cobrança registrada no banco).
 */
export function pixBrCode(p: PixPayee, amount?: string | null): string {
  const name = pixText(p.name, PIX_NAME_MAX) || 'RECEBEDOR';
  const city = pixText(p.city, PIX_CITY_MAX) || 'BRASIL';
  const value = amount && Number(amount) > 0 ? Number(amount).toFixed(2) : null;
  const payload =
    field('00', '01') +
    field('26', field('00', 'br.gov.bcb.pix') + field('01', p.key)) +
    field('52', '0000') +
    field('53', '986') +
    (value ? field('54', value) : '') +
    field('58', 'BR') +
    field('59', name) +
    field('60', city) +
    field('62', field('05', '***')) +
    '6304';
  return payload + crc16(payload);
}
