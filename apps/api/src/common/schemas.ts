import {
  isMoneyString,
  isValidCnpj,
  isValidCpf,
  ORDER_CHANNELS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PASSWORD_MIN,
  weakPasswordReason,
} from '@comandou/shared';
import { z } from 'zod';

/** Valor monetário positivo em string decimal (ex.: "12.50"). Nunca float. */
export const money = z
  .string()
  .refine(isMoneyString, 'valor monetário com até 2 casas')
  .refine((v) => !v.startsWith('-'), 'valor não pode ser negativo');

export const uuid = z.string().uuid();

/**
 * Senha NOVA (cadastro, troca, nova senha): mínimo e recusa das senhas óbvias. O login continua
 * aceitando qualquer senha já cadastrada, então ninguém fica para fora por causa da regra.
 */
export const newPassword = (min = PASSWORD_MIN) =>
  z
    .string()
    .max(200)
    .superRefine((v, ctx) => {
      const why = weakPasswordReason(v, [], min);
      if (why) ctx.addIssue({ code: 'custom', message: why });
    });

/** A senha não pode ser o e-mail, o telefone ou o nome que vieram no mesmo formulário. */
export function notPersonal<T extends object>(
  pick: (v: T) => { password?: string | null; personal: (string | null | undefined)[] },
) {
  return (v: T, ctx: z.RefinementCtx) => {
    const { password, personal } = pick(v);
    // Senha óbvia por si só já foi recusada pelo newPassword(): não repete o motivo.
    if (!password || weakPasswordReason(password, [], 0)) return;
    const why = weakPasswordReason(password, personal, 0);
    if (why) ctx.addIssue({ code: 'custom', path: ['password'], message: why });
  };
}
export const reason = z.string().trim().min(3).max(300);

const OrderItemIn = z.object({
  productId: uuid,
  // Quantidade com até 3 casas (ex.: 0.350 kg); limite operacional de 999.
  quantity: z
    .number()
    .positive()
    .max(999)
    .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'até 3 casas decimais'),
  notes: z.string().trim().max(200).optional(),
  optionIds: z.array(uuid).max(50).optional(),
});

/** Fiado: vai para a Agenda pessoal de quem vendeu e o WhatsApp do restaurante cobra no dia. */
export const FiadoIn = z.object({
  name: z.string().trim().min(1, 'Informe quem está devendo').max(80),
  phone: z.string().trim().min(8, 'Informe o WhatsApp de quem deve').max(25),
  dueAt: z.string().datetime({ offset: true }),
});

export const CreateOrder = z.object({
  channel: z.enum(ORDER_CHANNELS),
  tabId: uuid.optional(),
  tableId: uuid.optional(),
  customerName: z.string().trim().max(80).optional(),
  customerPhone: z.string().trim().max(30).optional(),
  /** Cliente escolhido no pedido: liga à ficha dele (histórico, nota fiscal). */
  customerId: uuid.optional(),
  /** Recompensa dos pontos do cliente escolhido (Nova venda). Exige `customerId`. */
  rewardId: uuid.optional(),
  /** Cupom da loja usado pelo cliente escolhido (Nova venda). Exige `customerId`. */
  couponCode: z.string().trim().min(2).max(30).optional(),
  deliveryAddress: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(500).optional(),
  deliveryFee: money.optional(),
  discount: money.optional(),
  surcharge: money.optional(),
  items: z.array(OrderItemIn).min(1).max(200),
  /** Vender fiado (Nova venda › Fiado): quem deve, o WhatsApp e quando paga. Exige gerente. */
  fiado: FiadoIn.optional(),
});

/** Edição do pedido já lançado (acrescentar, mudar quantidade/observação, tirar itens). */
export const EditOrderItems = z.object({
  expectedVersion: z.number().int().positive().optional(),
  add: z.array(OrderItemIn).max(100).optional(),
  change: z
    .array(
      z.object({
        itemId: uuid,
        quantity: OrderItemIn.shape.quantity.optional(),
        notes: z.string().trim().max(200).nullable().optional(),
      }),
    )
    .max(200)
    .optional(),
  remove: z.array(uuid).max(200).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  reason: z.string().trim().max(300).optional(),
});

export const Transition = z.object({
  to: z.enum(ORDER_STATUSES),
  reason: z.string().trim().max(300).optional(),
  expectedVersion: z.number().int().positive().optional(),
  /** Concluir com saldo como "a receber" (exige gerente e motivo). */
  receivable: z.boolean().optional(),
  /** Pedido de aplicativo: código do motivo de cancelamento que o aplicativo aceita (ex.: 503). */
  channelReason: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,40}$/)
    .optional(),
});

export const Adjust = z
  .object({
    discount: money.optional(),
    surcharge: money.optional(),
    /** Frete (taxa de entrega) do pedido, ao fechar a conta. */
    deliveryFee: money.optional(),
    reason,
  })
  .refine(
    (b) => b.discount !== undefined || b.surcharge !== undefined || b.deliveryFee !== undefined,
    'informe desconto, acréscimo ou frete',
  );

export const Payment = z.object({
  cashSessionId: uuid,
  method: z.enum(PAYMENT_METHODS),
  amount: money,
  tendered: money.optional(),
  /** CPF ou CNPJ na nota (só dígitos), guardado no pedido para a NFC-e. */
  taxDocument: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().regex(/^([0-9]{11}|[0-9]{14})?$/, 'CPF com 11 ou CNPJ com 14 dígitos'))
    .refine((v) => !v || (v.length === 11 ? isValidCpf(v) : isValidCnpj(v)), 'CPF ou CNPJ inválido')
    .nullish()
    .transform((v) => v || null),
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
