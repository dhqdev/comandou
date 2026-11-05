/**
 * Prompt da IA que atende o cliente (WhatsApp e o teste do gerente). Função pura: recebe o que o
 * gerente configurou, o cardápio liberado e o estado da loja, e devolve as instruções do modelo.
 * Só entra no prompt o que o gerente deixou a IA ver.
 */

export type AgentTone = 'friendly' | 'formal' | 'fun';
export type AgentReplyWhen = 'always' | 'open';

/** Configuração da IA salva pelo gerente (com os padrões quando ainda não salvou). */
export interface AgentSettings {
  whatsappEnabled: boolean;
  agentName: string | null;
  tone: AgentTone;
  greeting: string | null;
  about: string | null;
  rules: string | null;
  handoffMessage: string | null;
  suggestItems: boolean;
  showPrices: boolean;
  sendStoreLink: boolean;
  replyWhen: AgentReplyWhen;
}

export const AGENT_DEFAULTS: AgentSettings = {
  whatsappEnabled: false,
  agentName: null,
  tone: 'friendly',
  greeting: null,
  about: null,
  rules: null,
  handoffMessage: null,
  suggestItems: true,
  showPrices: true,
  sendStoreLink: true,
  replyWhen: 'always',
};

export const DEFAULT_HANDOFF =
  'Vou chamar alguém da nossa equipe para continuar com você, só um instante.';

/** Marca que o modelo põe no fim da resposta quando precisa de uma pessoa da equipe. */
export const HANDOFF_TAG = '[[ATENDENTE]]';

export interface AgentMenuOption {
  name: string;
  priceDelta: string;
}
export interface AgentMenuGroup {
  name: string;
  minSelect: number;
  maxSelect: number;
  options: AgentMenuOption[];
}
export interface AgentMenuItem {
  name: string;
  description: string | null;
  price: string;
  soldOut: boolean;
  /** Vendido por peso: o preço é do quilo e o valor final sai na balança. */
  soldByWeight?: boolean;
  optionGroups: AgentMenuGroup[];
}
export interface AgentMenuCategory {
  name: string;
  products: AgentMenuItem[];
}

/** Como está a loja agora (vem de tenant_store_settings). */
export interface AgentStore {
  /** Endereço do cardápio online para o cliente pedir. */
  storeUrl: string | null;
  openNow: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  deliveryFee: string | null;
  minOrder: string | null;
  etaMin: number | null;
  etaMax: number | null;
  address: string | null;
  /** Horário de funcionamento já em texto ("seg 18:00–23:00; ter …"). */
  hours: string | null;
}

const TONES: Record<AgentTone, string> = {
  friendly:
    'simpático e acolhedor, como um bom atendente de restaurante; pode usar um emoji de vez em quando',
  formal: 'educado e formal, tratando o cliente por "senhor" ou "senhora" e sem emojis',
  fun: 'descontraído e animado, com bom humor e emojis, sem exagerar',
};

export const TONE_LABELS: Record<AgentTone, string> = {
  friendly: 'Simpático',
  formal: 'Formal',
  fun: 'Descontraído',
};

/** "12.50" → "R$ 12,50". */
export function brl(v: string | number): string {
  const n = Number(v);
  return `R$ ${(Number.isFinite(n) ? n : 0).toFixed(2).replace('.', ',')}`;
}

/** Cardápio em texto curto (conta tokens): categoria, item, preço, descrição e complementos. */
export function menuText(menu: AgentMenuCategory[], showPrices: boolean): string {
  const lines: string[] = [];
  for (const c of menu) {
    if (!c.products.length) continue;
    lines.push(`## ${c.name}`);
    for (const p of c.products) {
      const price = showPrices
        ? ` — ${brl(p.price)}${p.soldByWeight ? ' o kg (POR PESO)' : ''}`
        : p.soldByWeight
          ? ' (POR PESO)'
          : '';
      const out = p.soldOut ? ' (ESGOTADO hoje)' : '';
      const desc = p.description ? `: ${p.description.replace(/\s+/g, ' ').slice(0, 160)}` : '';
      lines.push(`- ${p.name}${price}${out}${desc}`);
      for (const g of p.optionGroups) {
        if (!g.options.length) continue;
        const rule =
          g.minSelect > 0
            ? `escolha ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect} a ${g.maxSelect}`}`
            : `até ${g.maxSelect}`;
        const opts = g.options
          .slice(0, 20)
          .map((o) =>
            showPrices && Number(o.priceDelta) > 0 ? `${o.name} (+${brl(o.priceDelta)})` : o.name,
          )
          .join(', ');
        lines.push(`  - ${g.name} (${rule}): ${opts}`);
      }
    }
  }
  return lines.join('\n');
}

export function customerPrompt(o: {
  settings: AgentSettings;
  /** Nome usado quando o gerente não deu um nome à IA. */
  fallbackName: string;
  tenantName: string;
  menu: AgentMenuCategory[];
  store: AgentStore;
  customerName?: string | null;
  now: Date;
  timezone?: string;
}): string {
  const s = o.settings;
  const name = s.agentName?.trim() || o.fallbackName;
  const menu = menuText(o.menu, s.showPrices);
  const st = o.store;
  const handoff = s.handoffMessage?.trim() || DEFAULT_HANDOFF;

  const can: string[] = [
    'Tirar dúvidas sobre o cardápio, ingredientes, complementos e disponibilidade.',
  ];
  if (s.showPrices) can.push('Informar preços exatamente como estão no cardápio abaixo.');
  else
    can.push(
      'Não informar preços; se o cliente perguntar, diga que o valor aparece no cardápio online.',
    );
  if (s.suggestItems)
    can.push('Sugerir itens e complementos do cardápio quando fizer sentido (sem insistir).');
  if (s.sendStoreLink && st.storeUrl)
    can.push(
      `Para fazer o pedido, mandar o link do cardápio online: ${st.storeUrl} (o cliente monta o pedido, paga e acompanha por lá).`,
    );

  const storeLines: string[] = [];
  storeLines.push(
    st.openNow
      ? 'A loja está ABERTA agora para pedidos.'
      : 'A loja está FECHADA agora para pedidos.',
  );
  if (st.hours) storeLines.push(`Horário: ${st.hours}.`);
  const modes = [st.acceptsDelivery && 'entrega', st.acceptsPickup && 'retirada no local'].filter(
    Boolean,
  );
  if (modes.length) storeLines.push(`Atende por: ${modes.join(' e ')}.`);
  if (st.acceptsDelivery) {
    if (st.deliveryFee && Number(st.deliveryFee) > 0)
      storeLines.push(`Taxa de entrega a partir de ${brl(st.deliveryFee)} (varia pelo bairro).`);
    if (st.etaMin && st.etaMax)
      storeLines.push(`Tempo de entrega: ${st.etaMin} a ${st.etaMax} minutos.`);
  }
  if (st.minOrder && Number(st.minOrder) > 0)
    storeLines.push(`Pedido mínimo: ${brl(st.minOrder)}.`);
  if (st.address) storeLines.push(`Endereço: ${st.address}.`);

  return `Você é ${name}, atendente virtual do restaurante "${o.tenantName}" no WhatsApp. Você conversa com clientes.

Jeito de falar: ${TONES[s.tone]}. Responda em português do Brasil, em mensagens curtas (no máximo uns 4 parágrafos curtos), como numa conversa de WhatsApp. Use *asterisco* para negrito, nunca Markdown com # ou links em [colchetes].

O que você pode fazer:
${can.map((l) => `- ${l}`).join('\n')}

Regras que você sempre segue:
- Fale apenas dos itens do cardápio abaixo. Se o cliente pedir algo que não está nele, diga que não tem e sugira o mais parecido da lista. Nunca invente item, preço, promoção, prazo ou ingrediente.
- Item marcado como ESGOTADO não pode ser pedido hoje.
${weightRule(o.menu, s.showPrices)}- Você não fecha pedido, não recebe pagamento, não dá desconto e não cancela nada por aqui.
- Nunca peça dados de cartão, senhas ou documentos.
- Se o cliente reclamar, pedir para falar com uma pessoa, tiver um problema com um pedido já feito, ou você não souber responder, responda exatamente: "${handoff}" e termine a mensagem com ${HANDOFF_TAG}.
- Não diga que é uma IA da OpenAI, Google ou outra empresa; se perguntarem, diga que é o atendente virtual do restaurante.
${s.rules?.trim() ? `\nRegras do restaurante (o gerente pediu):\n${s.rules.trim()}\n` : ''}
${s.greeting?.trim() ? `Na primeira mensagem da conversa, cumprimente assim (pode adaptar ao que o cliente disse): "${s.greeting.trim()}"\n` : ''}
Sobre a loja agora:
${storeLines.map((l) => `- ${l}`).join('\n')}
${s.about?.trim() ? `\nSobre a casa (informado pelo gerente):\n${s.about.trim()}\n` : ''}
${o.customerName ? `Nome do cliente no WhatsApp: ${o.customerName}.\n` : ''}Data e hora: ${o.now.toLocaleString('pt-BR', { timeZone: o.timezone ?? 'America/Sao_Paulo' })}.

Cardápio (só o que você pode oferecer):
${menu || '(nenhum item liberado: diga que o cardápio está sendo atualizado e ofereça chamar alguém da equipe)'}`;
}

/**
 * Regra de venda por peso (sorveteria, comida por quilo), só quando o cardápio tem item assim.
 * Com preço liberado, ensina a fazer a conta de cabeça (gramas × preço do kg).
 */
export function weightRule(menu: AgentMenuCategory[], showPrices: boolean): string {
  const any = menu.some((c) => c.products.some((p) => p.soldByWeight));
  if (!any) return '';
  const calc = showPrices
    ? ' Se o cliente quiser saber quanto fica, faça a conta pelo peso (ex.: 300 g de um item de R$ 50,00 o kg = 0,3 × 50 = R$ 15,00) e diga que é uma estimativa: o valor certo é o da balança.'
    : '';
  return `- Itens marcados POR PESO são vendidos no quilo: o preço mostrado é o do kg e o cliente paga pelo peso que levar. No cardápio online o cliente escolhe o peso (de 100 g a 5 kg); no balcão, é pesado na hora.${calc} Nunca trate o preço do kg como preço de uma unidade.
`;
}

/** Tira a marca de "chamar atendente" da resposta do modelo. */
export function parseReply(text: string): { text: string; handoff: boolean } {
  const handoff = text.includes(HANDOFF_TAG);
  const clean = text.split(HANDOFF_TAG).join('').trim();
  return { text: clean, handoff };
}

const DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Horário da loja em texto curto: "seg 18:00–23:00; ter 18:00–23:00". */
export function hoursText(hours: { day: number; open: string; close: string }[]): string | null {
  if (!hours.length) return null;
  return [...hours]
    .sort((a, b) => a.day - b.day || a.open.localeCompare(b.open))
    .map((h) => `${DAYS[h.day] ?? h.day} ${h.open}–${h.close}`)
    .join('; ');
}
