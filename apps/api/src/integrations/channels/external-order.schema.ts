import { CHANNEL_ID_RE, isMoneyString, type ExternalOrder } from '@comandou/shared';
import { z } from 'zod';

/**
 * Pedido normalizado conferido antes de entrar: todo adaptador devolve isto e nada fora daqui
 * chega ao banco. Dinheiro em string decimal ("12.90"), nunca float.
 */
const money = z.string().refine(isMoneyString, 'valor inválido');
const text = (max: number) => z.string().trim().min(1).max(max);
const iso = z.string().refine((v) => Number.isFinite(Date.parse(v)), 'data inválida');
const qty = z.number().positive().max(10_000);

const Option = z.object({
  externalId: text(100).optional(),
  externalCode: text(100).optional(),
  name: text(200),
  quantity: qty,
  unitPrice: money,
});

const Item = z.object({
  externalId: text(100).optional(),
  externalCode: text(100).optional(),
  name: text(200),
  quantity: qty,
  unit: z.enum(['un', 'kg']).optional(),
  unitPrice: money,
  total: money,
  notes: z.string().trim().max(500).optional(),
  options: z.array(Option).max(100),
});

export const ExternalOrderSchema = z.object({
  channel: z.string().regex(CHANNEL_ID_RE),
  externalId: text(100),
  displayCode: text(40),
  storeId: text(100),
  createdAt: iso,
  fulfillment: z.enum(['delivery', 'takeout', 'dine_in']),
  timing: z.enum(['immediate', 'scheduled']),
  scheduledFor: iso.optional(),
  prepareFrom: iso.optional(),
  deliveredBy: z.enum(['merchant', 'channel']),
  customer: z.object({
    name: z.string().trim().max(120),
    phone: z.string().trim().max(40).optional(),
    phoneLocator: z.string().trim().max(40).optional(),
    taxDocument: z
      .string()
      .regex(/^(\d{11}|\d{14})$/)
      .optional(),
  }),
  address: z
    .object({
      text: text(400),
      complement: z.string().trim().max(200).optional(),
      reference: z.string().trim().max(200).optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
    })
    .optional(),
  items: z.array(Item).min(1).max(200),
  totals: z.object({
    subtotal: money,
    deliveryFee: money,
    serviceFee: money,
    total: money,
  }),
  discounts: z
    .array(
      z.object({
        amount: money,
        sponsor: z.enum(['channel', 'merchant']),
        target: z.enum(['items', 'delivery']),
        description: z.string().trim().max(200).optional(),
      }),
    )
    .max(20),
  payments: z
    .array(
      z.object({
        prepaid: z.boolean(),
        method: z.enum(['cash', 'credit', 'debit', 'pix', 'voucher', 'other']),
        amount: money,
        brand: z.string().trim().max(40).optional(),
        changeFor: money.optional(),
      }),
    )
    .max(10),
  notes: z.string().trim().max(1000).optional(),
  pickupCode: z.string().trim().max(40).optional(),
  deadlines: z.object({ confirmBy: iso.optional() }).optional(),
}) satisfies z.ZodType<ExternalOrder>;

export function parseExternalOrder(v: unknown): ExternalOrder {
  return ExternalOrderSchema.parse(v);
}
