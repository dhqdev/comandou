import { isMoneyString, ORDER_CHANNELS, ORDER_STATUSES, PAYMENT_METHODS } from '@comandou/shared';
import { z } from 'zod';

/** Valor monetário positivo em string decimal (ex.: "12.50"). Nunca float. */
export const money = z
  .string()
  .refine(isMoneyString, 'valor monetário com até 2 casas')
  .refine((v) => !v.startsWith('-'), 'valor não pode ser negativo');

export const uuid = z.string().uuid();
export const reason = z.string().trim().min(3).max(300);

export const CreateOrder = z.object({
  channel: z.enum(ORDER_CHANNELS),
  tabId: uuid.optional(),
  tableId: uuid.optional(),
  customerName: z.string().trim().max(80).optional(),
  customerPhone: z.string().trim().max(30).optional(),
  deliveryAddress: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(500).optional(),
  deliveryFee: money.optional(),
  discount: money.optional(),
  surcharge: money.optional(),
  items: z
    .array(
      z.object({
        productId: uuid,
        // Quantidade com até 3 casas (ex.: 0.350 kg); limite operacional de 999.
        quantity: z
          .number()
          .positive()
          .max(999)
          .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'até 3 casas decimais'),
        notes: z.string().trim().max(200).optional(),
        optionIds: z.array(uuid).max(50).optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const Transition = z.object({
  to: z.enum(ORDER_STATUSES),
  reason: z.string().trim().max(300).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export const Adjust = z
  .object({ discount: money.optional(), surcharge: money.optional(), reason })
  .refine(
    (b) => b.discount !== undefined || b.surcharge !== undefined,
    'informe desconto ou acréscimo',
  );

export const Payment = z.object({
  cashSessionId: uuid,
  method: z.enum(PAYMENT_METHODS),
  amount: money,
  tendered: money.optional(),
});

/** Quantidade de estoque em string decimal com até 3 casas (ex.: "0.350"). Nunca float. */
export const qty = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,3})?$/, 'quantidade com até 3 casas decimais');
export const positiveQty = qty.refine((v) => Number(v) > 0, 'quantidade deve ser maior que zero');
/** Custo unitário com até 4 casas. */
export const unitCost = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,4})?$/, 'custo com até 4 casas decimais');
/** Data de calendário AAAA-MM-DD. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD')
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  }, 'data inválida');
