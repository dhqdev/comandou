import { isMoneyString, ORDER_CHANNELS, ORDER_STATUSES, PAYMENT_METHODS } from '@pedemais/shared';
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
