import { orderStatusText } from './ai-agent-prompt';
import {
  addressLine,
  addToCart,
  amount,
  b,
  cartCount,
  cartText,
  catsText,
  changeText,
  choice,
  choices,
  clean,
  findItem,
  type Flow,
  type FlowAddress,
  type FlowCategory,
  type FlowItem,
  type FlowSettings,
  groupsToAsk,
  homeEntries,
  homeText,
  i,
  isCancelWord,
  isCartWord,
  isGreeting,
  isMenuWord,
  itemsText,
  type ItemDraft,
  money,
  newFlow,
  notesText,
  num,
  optionNames,
  options,
  optionText,
  parseAddress,
  PAY_LABEL,
  payText,
  type PayMethod,
  qtyText,
  quantity,
  quote,
  readOrderText,
  removeText,
  reviewText,
  STATUS_DOT,
  subtotal,
  type TextPick,
  unitPrice,
  upsellFor,
} from './wa-flow';

/** Como está a loja agora, para o menu. Valores em centavos. */
export interface FlowStore {
  open: boolean;
  /** "Abrimos às 18:00" (null = sem horário cadastrado). */
  closedNote: string | null;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  deliveryFee: number;
  minOrder: number;
  eta: string | null;
  address: string | null;
  hours: string | null;
  reservations: boolean;
  menuFiles: number;
}

export interface FlowOrder {
  number: number;
  status: string;
  channel: string;
  total: string;
  createdAt: Date;
}

export type QuoteResult =
  | { ok: true; fee: number; minOrder: number | null; lat?: number; lng?: number }
  | { ok: false; reason: 'not_covered' | 'not_found' };

/** O que o menu precisa do restaurante (o serviço liga ao banco; os testes passam um falso). */
export interface FlowDeps {
  settings: FlowSettings;
  agentName: string;
  storeName: string;
  greeting: string | null;
  /** Nome do WhatsApp do cliente (pode não ser o real). */
  pushName: string | null;
  timezone: string;
  menu(): Promise<FlowCategory[]>;
  store(): Promise<FlowStore>;
  /** Cadastro do número desta conversa. */
  customer(): Promise<{ id: string; name: string } | null>;
  signup(name: string): Promise<{ id: string; name: string }>;
  addresses(customerId: string): Promise<FlowAddress[]>;
  quote(a: FlowAddress): Promise<QuoteResult>;
  saveAddress(customerId: string, a: FlowAddress): Promise<void>;
  place(
    f: Flow,
  ): Promise<{ number: number; status: string; total: string; trackUrl: string | null }>;
  orders(): Promise<FlowOrder[]>;
  /** Pedido escrito pela IA (só quando o leitor sem IA não entendeu e o dono deixou). */
  parseOrder?(text: string, menu: FlowCategory[]): Promise<TextPick[] | null>;
}

/** O que fazer com a mensagem. */
export interface FlowOut {
  /** Texto para mandar (vazio quando a IA responde). */
  text?: string;
  /** Novo estado (null = apaga). */
  flow: Flow | null;
  /** A IA responde (pergunta livre); `ask` troca o texto que vai para ela. */
  ai?: boolean;
  ask?: string;
  /** Passa para a equipe. */
  handoff?: boolean;
  /** Manda os arquivos do cardápio depois do texto. */
  menuFiles?: boolean;
  /** Pedido feito agora (número). */
  placed?: number;
}

const NAME_RE = /^[\p{L}][\p{L}\p{M}' .-]{1,59}$/u;

/**
 * O menu do WhatsApp: cada resposta do cliente anda uma tela. Tudo aqui é regra fixa (sem IA):
 * menu principal, cadastro, entrega ou retirada, endereço com a taxa, categorias, itens,
 * complementos, observação, sacola, pagamento, troco, conferência e o pedido feito.
 */
export class WaFlowEngine {
  constructor(private readonly d: FlowDeps) {}

  async handle(current: Flow | null, text: string): Promise<FlowOut> {
    const f: Flow = current ? { ...current, cart: [...(current.cart ?? [])] } : newFlow();
    const t = text.trim();
    if (isMenuWord(t) || (isGreeting(t) && (!current || f.at === 'home' || f.at === 'chat')))
      return this.home({ ...f, at: 'home' });
    if (isCartWord(t) && f.cart.length) return this.cart(f);
    if (isCancelWord(t) && current && f.at !== 'home' && f.at !== 'chat')
      return this.home(
        newFlow(),
        `Tudo bem, ${f.cart.length ? 'cancelei o pedido' : 'parei por aqui'}. 👍`,
      );

    switch (f.at) {
      case 'home':
        return this.onHome(f, t, !current);
      case 'chat':
        return this.onChat(f, t);
      case 'who':
        return this.onWho(f, t);
      case 'who_name':
      case 'signup_name':
        return this.onName(f, t);
      case 'mode':
        return this.onMode(f, t);
      case 'address':
        return this.onAddress(f, t);
      case 'address_new':
        return this.onAddressNew(f, t);
      case 'address_check':
        return this.onAddressCheck(f, t);
      case 'address_fail':
        return this.onAddressFail(f, t);
      case 'cats':
        return this.onCats(f, t);
      case 'items':
        return this.onItems(f, t);
      case 'qty':
        return this.onQty(f, t);
      case 'option':
        return this.onOption(f, t);
      case 'notes':
        return this.onNotes(f, t);
      case 'cart':
        return this.onCart(f, t);
      case 'remove':
        return this.onRemove(f, t);
      case 'pay':
        return this.onPay(f, t);
      case 'change':
        return this.onChange(f, t);
      case 'review':
        return this.onReview(f, t);
      default:
        return this.home(newFlow());
    }
  }

  // ------------------------------------------------------------------ menu principal

  private async entries() {
    const st = await this.d.store();
    return { st, entries: homeEntries(this.d.settings, { reservations: st.reservations }) };
  }

  private async home(f: Flow, before?: string): Promise<FlowOut> {
    const { st, entries } = await this.entries();
    const name = f.name ?? (await this.d.customer().catch(() => null))?.name ?? this.d.pushName;
    const text = homeText({
      agent: this.d.agentName,
      store: this.d.storeName,
      name,
      greeting: this.d.greeting,
      entries,
      open: st.open,
      closedNote: st.closedNote,
    });
    return { text: before ? `${before}\n\n${text}` : text, flow: { ...f, at: 'home' } };
  }

  private async onHome(f: Flow, t: string, first: boolean): Promise<FlowOut> {
    const n = choice(t);
    const { entries } = await this.entries();
    if (n !== null) {
      const e = entries[n - 1];
      if (!e) return this.home(f, `Não tenho a opção ${b(String(n))}. 🙂`);
      return this.entry(f, e.key);
    }
    // Pedido escrito direto ("2 smash e 1 coca"): vai para a sacola sem passar pelo menu.
    if (this.d.settings.takeOrders) {
      const picks = await this.readOrder(t, false);
      if (picks?.length) {
        const st = await this.d.store();
        if (!st.open) return this.home(f);
        return this.addPicks(f, picks);
      }
    }
    if (this.d.settings.freeChat) return { ai: true, flow: { ...f, at: 'home' } };
    return this.home(f, first ? undefined : `Não entendi 🤔`);
  }

  private async entry(f: Flow, key: string): Promise<FlowOut> {
    const st = await this.d.store();
    switch (key) {
      case 'order':
        if (!st.open)
          return this.home(
            f,
            `🔴 ${b('Estamos fechados agora')} e não dá para pedir.${st.closedNote ? ` ${st.closedNote}` : ''}`,
          );
        return this.advance({ ...f, checkout: undefined });
      case 'status':
        return { text: await this.statusText(), flow: { ...f, at: 'home' } };
      case 'menu':
        return this.showMenu(f, st);
      case 'reserve':
        return { ai: true, ask: 'Quero reservar uma mesa', flow: { ...f, at: 'chat' } };
      case 'info':
        return { text: this.infoText(st), flow: { ...f, at: 'home' } };
      default:
        return { handoff: true, flow: null };
    }
  }

  private async onChat(f: Flow, t: string): Promise<FlowOut> {
    if (choice(t) !== null && t.length <= 3) return this.onHome({ ...f, at: 'home' }, t, false);
    return { ai: true, flow: f };
  }

  private async showMenu(f: Flow, st: FlowStore): Promise<FlowOut> {
    const tail = this.d.settings.takeOrders
      ? `\n\n🛵 Para pedir, mande ${num(1)} ou escreva o pedido, ex.: ${'`2 smash e 1 coca`'}.`
      : '';
    if (this.d.settings.sendPdfs && st.menuFiles > 0)
      return {
        text: `📖 Aqui está o nosso cardápio! 👇${tail}`,
        menuFiles: true,
        flow: { ...f, at: 'home' },
      };
    const menu = await this.d.menu();
    const lines = [`📖 ${b(`Cardápio da ${this.d.storeName}`)}`];
    for (const c of menu) {
      lines.push('', b(clean(c.name)));
      for (const it of c.items.slice(0, 25))
        lines.push(
          `- ${it.soldOut ? `~${clean(it.name)}~ ${i('esgotado')}` : clean(it.name)}${this.d.settings.showPrices && !it.soldOut ? ` — ${money(it.price)}` : ''}`,
        );
    }
    return { text: `${lines.join('\n').slice(0, 3600)}${tail}`, flow: { ...f, at: 'home' } };
  }

  private infoText(st: FlowStore): string {
    const lines = [`🕒 ${b(this.d.storeName)}`, ''];
    lines.push(
      st.open
        ? `🟢 ${b('Aberto agora')}`
        : `🔴 ${b('Fechado agora')}${st.closedNote ? ` — ${st.closedNote}` : ''}`,
    );
    if (st.hours) lines.push('', b('Horário'), ...st.hours.split('; ').map((h) => `- ${h}`));
    if (st.address) lines.push('', `📍 ${b('Endereço')}`, clean(st.address));
    const modes = [st.acceptsDelivery && '🛵 Entrega', st.acceptsPickup && '🏃 Retirada'].filter(
      Boolean,
    );
    if (modes.length) lines.push('', modes.join(' · '));
    if (st.acceptsDelivery && st.deliveryFee > 0)
      lines.push(
        `Taxa de entrega a partir de ${b(money(st.deliveryFee))} ${i('(varia pelo bairro)')}`,
      );
    if (st.eta) lines.push(`Tempo de entrega: ${st.eta}`);
    if (st.minOrder > 0) lines.push(`Pedido mínimo: ${money(st.minOrder)}`);
    lines.push(
      '',
      `💳 ${this.d.settings.payMethods.map((m) => PAY_LABEL[m]).join(', ')}`,
      '',
      quote(`Mande ${b('menu')} para ver as opções.`),
    );
    return lines.join('\n');
  }

  private async statusText(): Promise<string> {
    const orders = await this.d.orders();
    if (!orders.length)
      return [
        `📦 Não achei pedido de hoje com este número.`,
        i('Se pediu por outro telefone, me passe o número do pedido que eu chamo a equipe.'),
        '',
        quote(`Mande ${b('menu')} para ver as opções.`),
      ].join('\n');
    const lines = [`📦 ${b('Seus pedidos')}`];
    for (const o of orders) {
      const at = o.createdAt.toLocaleTimeString('pt-BR', {
        timeZone: this.d.timezone,
        hour: '2-digit',
        minute: '2-digit',
      });
      lines.push(
        '',
        `${b(`#${o.number}`)} · ${at} · ${money(o.total)}`,
        `${STATUS_DOT[o.status] ?? '•'} ${i(orderStatusText(o))}`,
      );
    }
    lines.push('', quote(`Mande ${b('menu')} para voltar ao início.`));
    return lines.join('\n');
  }

  // ------------------------------------------------------------------ próximo passo do pedido

  /**
   * Vai para o primeiro dado que falta: quem pede, entrega ou retirada, endereço, itens,
   * pagamento, troco e, por fim, a conferência.
   */
  private async advance(f: Flow, before?: string): Promise<FlowOut> {
    const say = (o: FlowOut): FlowOut =>
      before && o.text ? { ...o, text: `${before}\n\n${o.text}` } : o;
    if (!f.name) return say(await this.who(f));
    const st = await this.d.store();
    const modes = this.modes(st);
    if (!modes.length)
      return say(await this.home(newFlow(), '😕 Não estamos recebendo pedidos por aqui agora.'));
    if (!f.mode || !modes.includes(f.mode)) {
      if (modes.length === 1) return this.advance({ ...f, mode: modes[0] }, before);
      return say(this.modeScreen(f, st));
    }
    if (f.mode === 'delivery' && !f.address) return say(await this.addressScreen(f));
    if (!f.cart.length) return say(await this.cats(f));
    if (!f.checkout) return say(await this.cart(f));
    const sub = subtotal(f.cart);
    const min = f.mode === 'delivery' ? (f.minOrder ?? st.minOrder) : st.minOrder;
    if (min > 0 && sub < min)
      return say(
        await this.cart(
          { ...f, checkout: undefined },
          `⚠️ O pedido mínimo é ${b(money(min))}. Faltam ${money(min - sub)}.`,
        ),
      );
    const methods = this.d.settings.payMethods;
    if (!f.pay || !methods.includes(f.pay)) {
      if (methods.length === 1) return this.advance({ ...f, pay: methods[0] }, before);
      return say({ text: payText(methods, f.mode), flow: { ...f, at: 'pay' } });
    }
    const total = sub + (f.mode === 'delivery' ? (f.fee ?? 0) : 0);
    if (f.pay === 'cash' && f.changeFor === undefined)
      return say({ text: changeText(total), flow: { ...f, at: 'change' } });
    return say({
      text: reviewText(f, {
        showPrices: true,
        eta: f.mode === 'delivery' ? st.eta : null,
        storeAddress: st.address,
      }),
      flow: { ...f, at: 'review' },
    });
  }

  private modes(st: FlowStore): ('delivery' | 'pickup')[] {
    const out: ('delivery' | 'pickup')[] = [];
    if (st.acceptsDelivery && this.d.settings.orderDelivery) out.push('delivery');
    if (st.acceptsPickup && this.d.settings.orderPickup) out.push('pickup');
    return out;
  }

  // ------------------------------------------------------------------ quem pede

  private async who(f: Flow): Promise<FlowOut> {
    const c = await this.d.customer();
    const st = this.d.settings;
    if (c)
      return {
        text: [
          `📋 Achei seu cadastro: ${b(c.name)}.`,
          '',
          options(['✅ Sou eu, continuar', '🙅 Não sou eu']),
        ].join('\n'),
        flow: { ...f, at: 'who', pick: [c.id] },
      };
    if (!st.offerSignup && st.guestOrders)
      return { text: `👤 Qual nome coloco no pedido?`, flow: { ...f, at: 'who_name', pick: [] } };
    if (st.offerSignup && !st.guestOrders)
      return {
        text: [
          `📋 ${b('Cadastro rápido')}`,
          'Não achei cadastro com este número. É só me dizer seu nome. ✍️',
          i('Seus pedidos ficam salvos e da próxima vez é mais rápido.'),
        ].join('\n'),
        flow: { ...f, at: 'signup_name', pick: [] },
      };
    return {
      text: [
        `📋 ${b('Cadastro')}`,
        'Não achei cadastro com este número.',
        '',
        options([
          `✍️ Quero me cadastrar ${i('(só o nome, leva 10 segundos)')}`,
          '🛵 Pedir sem cadastro',
        ]),
        '',
        quote('Já tem cadastro com outro número? Mande mensagem por ele.'),
      ].join('\n'),
      flow: { ...f, at: 'who', pick: [] },
    };
  }

  private async onWho(f: Flow, t: string): Promise<FlowOut> {
    const n = choice(t);
    const found = f.pick?.[0];
    if (found) {
      if (n === 1) {
        const c = await this.d.customer();
        if (c) return this.advance({ ...f, customerId: c.id, name: c.name, pick: undefined });
      }
      if (n === 2)
        return {
          text: `👤 Tudo bem! Qual nome coloco no pedido?`,
          flow: { ...f, at: 'who_name', pick: [] },
        };
      return this.retry(f, await this.who(f));
    }
    if (n === 1)
      return {
        text: `✍️ Qual é o seu nome?`,
        flow: { ...f, at: 'signup_name', pick: [] },
      };
    if (n === 2)
      return { text: `👤 Qual nome coloco no pedido?`, flow: { ...f, at: 'who_name', pick: [] } };
    // Mandou o nome direto: cadastra (ou só usa no pedido, se o cadastro está desligado).
    if (NAME_RE.test(t) && t.split(' ').length <= 6)
      return this.onName({ ...f, at: this.d.settings.offerSignup ? 'signup_name' : 'who_name' }, t);
    return this.retry(f, await this.who(f));
  }

  private async onName(f: Flow, t: string): Promise<FlowOut> {
    const name = clean(t).replace(/^(meu nome e|me chamo|sou o|sou a|eu sou)\s+/i, '');
    if (!NAME_RE.test(name) || name.length < 2)
      return { text: `Me diga só o seu nome, por favor ${i('(ex.: Maria Silva)')}.`, flow: f };
    const nice = name
      .toLowerCase()
      .split(' ')
      .map((w) => (w.length > 2 ? w[0]!.toUpperCase() + w.slice(1) : w))
      .join(' ')
      .replace(/^./, (c) => c.toUpperCase());
    if (f.at === 'signup_name') {
      const c = await this.d.signup(nice);
      return this.advance(
        { ...f, customerId: c.id, name: c.name, pick: undefined },
        `✅ Cadastro feito, ${b(c.name.split(' ')[0]!)}! Seus pedidos ficam salvos por aqui.`,
      );
    }
    return this.advance({ ...f, customerId: null, name: nice, pick: undefined });
  }

  // ------------------------------------------------------------------ entrega ou retirada

  private modeScreen(f: Flow, st: FlowStore): FlowOut {
    const del = `🛵 Entrega${st.deliveryFee > 0 || st.eta ? ` ${i(`(${[st.deliveryFee > 0 ? `taxa a partir de ${money(st.deliveryFee)}` : null, st.eta].filter(Boolean).join(' · ')})`)}` : ''}`;
    const pick = `🏃 Retirar na loja${st.address ? ` ${i(`(${clean(st.address).slice(0, 60)})`)}` : ''}`;
    return {
      text: [`Como você prefere receber?`, '', options([del, pick]), BACK_LINE].join('\n'),
      flow: { ...f, at: 'mode' },
    };
  }

  private async onMode(f: Flow, t: string): Promise<FlowOut> {
    const st = await this.d.store();
    const n = choice(t);
    if (n === 0) return this.home(f);
    const w = t.toLowerCase();
    const mode =
      n === 1 || /entreg|deliver/.test(w)
        ? 'delivery'
        : n === 2 || /retir|buscar|pegar/.test(w)
          ? 'pickup'
          : null;
    if (!mode) return this.retry(f, this.modeScreen(f, st));
    if (!this.modes(st).includes(mode))
      return {
        text: `😕 ${mode === 'delivery' ? 'Não estamos entregando' : 'Não estamos com retirada'} agora.\n\n${this.modeScreen(f, st).text}`,
        flow: { ...f, at: 'mode' },
      };
    return this.advance({
      ...f,
      mode,
      ...(mode === 'pickup' ? { address: undefined, fee: 0 } : {}),
    });
  }

  // ------------------------------------------------------------------ endereço

  private async addressScreen(f: Flow): Promise<FlowOut> {
    const saved = f.customerId ? await this.d.addresses(f.customerId) : [];
    if (!saved.length) return this.askAddress({ ...f, pick: [] });
    return {
      text: [
        `📍 ${b('Onde entregamos?')}`,
        '',
        options([...saved.slice(0, 8).map((a) => addressLine(a)), '➕ Outro endereço']),
        BACK_LINE,
      ].join('\n'),
      flow: { ...f, at: 'address', pick: saved.slice(0, 8).map((a) => a.savedId!) },
    };
  }

  private askAddress(f: Flow, before?: string): FlowOut {
    return {
      text: [
        before,
        `📍 Mande o endereço de entrega assim:`,
        '```Rua, número, bairro```',
        i('Ex.: Rua das Flores, 120, Centro, apto 12'),
      ]
        .filter(Boolean)
        .join('\n'),
      flow: { ...f, at: 'address_new' },
    };
  }

  private async onAddress(f: Flow, t: string): Promise<FlowOut> {
    const n = choice(t);
    if (n === 0) return this.home(f);
    const ids = f.pick ?? [];
    if (n === ids.length + 1) return this.askAddress(f);
    const id = n ? ids[n - 1] : undefined;
    if (!id) {
      // Escreveu um endereço novo direto.
      if (parseAddress(t)) return this.onAddressNew(f, t);
      return this.retry(f, await this.addressScreen(f));
    }
    const saved = (await this.d.addresses(f.customerId!)).find((a) => a.savedId === id);
    if (!saved) return this.addressScreen(f);
    return this.checkAddress(f, saved);
  }

  private async onAddressNew(f: Flow, t: string): Promise<FlowOut> {
    if (choice(t) === 0) return this.home(f);
    const a = parseAddress(t);
    if (!a) return this.askAddress(f, 'Não consegui entender o endereço 🤔');
    return this.checkAddress(f, a);
  }

  private async checkAddress(f: Flow, a: FlowAddress): Promise<FlowOut> {
    const q = await this.d.quote(a);
    if (!q.ok) {
      if (q.reason === 'not_found')
        return this.askAddress(
          f,
          `🗺️ Não achei ${b(addressLine(a))} no mapa. Confira a rua e o bairro (se puder, mande o CEP junto).`,
        );
      const st = await this.d.store();
      const pickup = this.modes(st).includes('pickup');
      return {
        text: [
          `😕 Ainda não entregamos em ${b(addressLine(a))}.`,
          '',
          options([
            '📍 Tentar outro endereço',
            ...(pickup ? ['🏃 Retirar na loja'] : []),
            '🙋 Falar com uma pessoa',
          ]),
        ].join('\n'),
        flow: {
          ...f,
          at: 'address_fail',
          pick: pickup ? ['addr', 'pickup', 'human'] : ['addr', 'human'],
        },
      };
    }
    const found: FlowAddress = { ...a, ...(q.lat !== undefined ? { lat: q.lat, lng: q.lng } : {}) };
    return {
      text: [
        `📍 Entrega em ${b(addressLine(found))}`,
        `🛵 Taxa de entrega: ${b(q.fee ? money(q.fee) : 'grátis')}${q.minOrder ? ` ${i(`· pedido mínimo ${money(q.minOrder)}`)}` : ''}`,
        '',
        options(['✅ Confirmar endereço', '✏️ Corrigir']),
      ].join('\n'),
      flow: {
        ...f,
        at: 'address_check',
        address: found,
        fee: q.fee,
        minOrder: q.minOrder ?? undefined,
        pick: undefined,
      },
    };
  }

  private async onAddressCheck(f: Flow, t: string): Promise<FlowOut> {
    const n = choice(t);
    if (n === 1 && f.address) {
      if (f.customerId && !f.address.savedId)
        await this.d.saveAddress(f.customerId, f.address).catch(() => undefined);
      return this.advance({ ...f, at: 'cats' });
    }
    if (n === 2) return this.askAddress({ ...f, address: undefined, fee: undefined });
    if (parseAddress(t)) return this.onAddressNew({ ...f, address: undefined }, t);
    return { text: `Mande ${num(1)} para confirmar ou ${num(2)} para corrigir.`, flow: f };
  }

  private async onAddressFail(f: Flow, t: string): Promise<FlowOut> {
    const n = choice(t);
    const what = n ? f.pick?.[n - 1] : undefined;
    if (what === 'addr') return this.askAddress({ ...f, address: undefined, pick: undefined });
    if (what === 'pickup')
      return this.advance({ ...f, mode: 'pickup', address: undefined, fee: 0, pick: undefined });
    if (what === 'human') return { handoff: true, flow: null };
    if (parseAddress(t)) return this.onAddressNew(f, t);
    return { text: `Mande o número da opção. 🙂`, flow: f };
  }

  // ------------------------------------------------------------------ cardápio e itens

  private async cats(f: Flow, before?: string): Promise<FlowOut> {
    const menu = await this.d.menu();
    if (!menu.length)
      return this.home(newFlow(), '😕 O cardápio está sendo atualizado. Tente daqui a pouco.');
    const text = catsText(menu, f.cart, { understandText: true });
    return {
      text: before ? `${before}\n\n${text}` : text,
      flow: { ...f, at: 'cats', cat: undefined },
    };
  }

  private async onCats(f: Flow, t: string): Promise<FlowOut> {
    const menu = await this.d.menu();
    const n = choice(t);
    if (n === 0) return f.cart.length ? this.cart(f) : this.home(f);
    if (n !== null) {
      const c = menu[n - 1];
      if (!c) return this.retry(f, await this.cats(f));
      return {
        text: itemsText(c, this.d.settings.showPrices),
        flow: { ...f, at: 'items', cat: n - 1 },
      };
    }
    const picks = await this.readOrder(t, true);
    if (picks?.length) return this.addPicks(f, picks);
    return this.cats(
      f,
      `Não achei isso no cardápio 🤔 Escolha pelo número${this.d.settings.understandText ? ' ou escreva o nome do item' : ''}.`,
    );
  }

  private async onItems(f: Flow, t: string): Promise<FlowOut> {
    const menu = await this.d.menu();
    const c = menu[f.cat ?? -1];
    const n = choice(t);
    if (!c || n === 0) return this.cats(f);
    if (n === null) {
      const picks = await this.readOrder(t, true);
      if (picks?.length) return this.addPicks(f, picks);
      return this.retry(f, { text: itemsText(c, this.d.settings.showPrices), flow: f });
    }
    const it = c.items[n - 1];
    if (!it) return this.retry(f, { text: itemsText(c, this.d.settings.showPrices), flow: f });
    if (it.soldOut)
      return {
        text: `😕 ${b(clean(it.name))} está esgotado hoje. Escolha outro:\n\n${itemsText(c, this.d.settings.showPrices)}`,
        flow: f,
      };
    if (it.soldByWeight)
      return {
        text: `⚖️ ${b(clean(it.name))} é vendido por peso e só dá para pedir na loja. Escolha outro:\n\n${itemsText(c, this.d.settings.showPrices)}`,
        flow: f,
      };
    return {
      text: qtyText(it, this.d.settings.showPrices),
      flow: { ...f, at: 'qty', draft: { productId: it.id, qty: 1, optionIds: [], group: -1 } },
    };
  }

  private async onQty(f: Flow, t: string): Promise<FlowOut> {
    const menu = await this.d.menu();
    const it = f.draft ? findItem(menu, f.draft.productId) : null;
    if (!it || !f.draft) return this.cats(f);
    if (choice(t) === 0) {
      const c = menu[f.cat ?? -1];
      return c
        ? {
            text: itemsText(c, this.d.settings.showPrices),
            flow: { ...f, at: 'items', draft: undefined },
          }
        : this.cats(f);
    }
    const q = quantity(t);
    if (!q) return { text: `Mande só a quantidade, de 1 a 50 ${i('(ex.: 2)')}.`, flow: f };
    return this.nextGroup({ ...f, draft: { ...f.draft, qty: q, group: -1 } }, menu);
  }

  /** Próximo grupo de complementos do item; sem grupos, a observação; depois entra na sacola. */
  private nextGroup(f: Flow, menu: FlowCategory[]): Promise<FlowOut> | FlowOut {
    const d = f.draft!;
    const it = findItem(menu, d.productId)!;
    const ask = groupsToAsk(it, !d.notesAsked);
    const next = ask.find((k) => k > d.group);
    if (next !== undefined) {
      const g = it.groups[next]!;
      return {
        text: optionText(it, g, this.d.settings.showPrices),
        flow: { ...f, at: 'option', draft: { ...d, group: next } },
      };
    }
    if (this.d.settings.itemNotes && !d.notesAsked && d.notes === undefined)
      return { text: notesText(it), flow: { ...f, at: 'notes' } };
    return this.commit(f, it);
  }

  private async onOption(f: Flow, t: string): Promise<FlowOut> {
    const menu = await this.d.menu();
    const d = f.draft;
    const it = d ? findItem(menu, d.productId) : null;
    const g = it && d ? it.groups[d.group] : undefined;
    if (!it || !d || !g) return this.cats(f);
    const picked = choices(t);
    const again = (msg: string): FlowOut => ({
      text: `${msg}\n\n${optionText(it, g, this.d.settings.showPrices)}`,
      flow: f,
    });
    if (!picked) {
      // Escreveu o nome da opção.
      const w = t.toLowerCase().trim();
      const k = g.options.findIndex((o) => o.name.toLowerCase() === w);
      if (k < 0) return again('Mande o número da opção. 🙂');
      return this.onOption(f, String(k + 1));
    }
    const none = picked.length === 1 && picked[0] === 0;
    const ids: string[] = [];
    if (!none)
      for (const n of picked) {
        const o = g.options[n - 1];
        if (!o) return again(`Não tenho a opção ${b(String(n))}.`);
        if (o.stockOut) return again(`😕 ${b(clean(o.name))} está em falta hoje.`);
        if (!g.allowRepeat && ids.includes(o.id)) continue;
        ids.push(o.id);
      }
    if (ids.length < g.minSelect)
      return again(
        g.minSelect === 1 ? 'Escolha uma opção, por favor.' : `Escolha pelo menos ${g.minSelect}.`,
      );
    if (ids.length > g.maxSelect) return again(`Pode escolher no máximo ${g.maxSelect}.`);
    return this.nextGroup({ ...f, draft: { ...d, optionIds: [...d.optionIds, ...ids] } }, menu);
  }

  private async onNotes(f: Flow, t: string): Promise<FlowOut> {
    const menu = await this.d.menu();
    const it = f.draft ? findItem(menu, f.draft.productId) : null;
    if (!it || !f.draft) return this.cats(f);
    const n = choice(t);
    const notes =
      n === 0 || /^(nao|não|nada|sem observa[cç][aã]o|n)$/i.test(t.trim())
        ? ''
        : clean(t).slice(0, 140);
    return this.commit({ ...f, draft: { ...f.draft, notes } }, it);
  }

  /** Item montado entra na sacola; com mais itens do pedido escrito na fila, segue para eles. */
  private async commit(f: Flow, it: FlowItem): Promise<FlowOut> {
    const d = f.draft!;
    const line = {
      productId: it.id,
      name: it.name,
      qty: d.qty,
      unit: unitPrice(it, d.optionIds),
      optionIds: d.optionIds,
      optionNames: optionNames(it, d.optionIds),
      ...(d.notes ? { notes: d.notes } : {}),
    };
    const cart = addToCart(f.cart, line);
    const added = `${b(`${d.qty}× ${clean(it.name)}`)}${line.optionNames.length ? ` ${i(`(${line.optionNames.join(', ')})`)}` : ''}`;
    const queue = f.queue ?? [];
    if (queue.length) {
      const [next, ...rest] = queue;
      const menu = await this.d.menu();
      const out = await this.nextGroup({ ...f, cart, draft: next, queue: rest }, menu);
      return out.text ? { ...out, text: `✅ Adicionei ${added}.\n\n${out.text}` } : out;
    }
    const done = { ...f, cart, draft: undefined, queue: undefined };
    if (!done.name || !done.mode || (done.mode === 'delivery' && !done.address))
      return this.advance(done, `✅ Adicionei ${added}.`);
    return this.cart(done, undefined, added);
  }

  // ------------------------------------------------------------------ pedido escrito

  /** Lê o pedido escrito: primeiro sem IA; não entendeu e o dono deixou, pela IA. */
  private async readOrder(t: string, inMenu: boolean): Promise<TextPick[] | null> {
    if (t.length < 3 || t.length > 600) return null;
    const menu = await this.d.menu();
    const local = readOrderText(t, menu);
    if (local) return local;
    if (!this.d.settings.understandText || !this.d.parseOrder) return null;
    // Fora das telas do cardápio, só chama a IA quando parece pedido (economiza tokens).
    if (!inMenu && !/\d|\b(quero|queria|manda|pedir|me v[eê]|gostaria|vou querer|traz)\b/i.test(t))
      return null;
    return this.d.parseOrder(t, menu).catch(() => null);
  }

  private async addPicks(f: Flow, picks: TextPick[]): Promise<FlowOut> {
    const menu = await this.d.menu();
    const drafts: ItemDraft[] = [];
    for (const p of picks) {
      const it = findItem(menu, p.productId);
      if (!it || it.soldOut || it.soldByWeight) continue;
      drafts.push({
        productId: it.id,
        qty: Math.max(1, Math.min(50, p.qty)),
        optionIds: [],
        group: -1,
        ...(p.notes ? { notes: p.notes, notesAsked: true } : { notesAsked: true }),
      });
    }
    if (!drafts.length) return this.cats(f, 'Não achei esses itens no cardápio 🤔');
    const [first, ...rest] = drafts;
    return this.nextGroup({ ...f, draft: first, queue: rest }, menu);
  }

  // ------------------------------------------------------------------ sacola

  private async cart(f: Flow, before?: string, added?: string): Promise<FlowOut> {
    const menu = await this.d.menu();
    const up = this.d.settings.suggestItems ? upsellFor(menu, f.cart) : null;
    const text = cartText(f.cart, { upsell: up, showPrices: this.d.settings.showPrices, added });
    return {
      text: before ? `${before}\n\n${text}` : text,
      flow: { ...f, at: 'cart', upsell: up?.id, draft: undefined },
    };
  }

  private async onCart(f: Flow, t: string): Promise<FlowOut> {
    const n = choice(t);
    if (!f.cart.length) return n === 1 ? this.cats(f) : this.home(f);
    if (n === 1) return this.cats(f);
    if (n === 2) return this.advance({ ...f, checkout: true });
    if (n === 3) return { text: removeText(f.cart), flow: { ...f, at: 'remove' } };
    if (n === 4 && f.upsell) {
      const menu = await this.d.menu();
      const it = findItem(menu, f.upsell);
      if (it)
        return this.commit(
          { ...f, draft: { productId: it.id, qty: 1, optionIds: [], group: -1, notesAsked: true } },
          it,
        );
    }
    if (n === 0) return this.cats(f);
    const picks = await this.readOrder(t, true);
    if (picks?.length) return this.addPicks(f, picks);
    return this.retry(f, await this.cart(f));
  }

  private async onRemove(f: Flow, t: string): Promise<FlowOut> {
    const n = choice(t);
    if (n === 0 || n === null) return this.cart(f);
    const line = f.cart[n - 1];
    if (!line) return { text: removeText(f.cart), flow: f };
    const cart = f.cart.filter((_, k) => k !== n - 1);
    return this.cart({ ...f, cart }, `🗑️ Tirei ${b(clean(line.name))}.`);
  }

  // ------------------------------------------------------------------ pagamento e conferência

  private async onPay(f: Flow, t: string): Promise<FlowOut> {
    const n = choice(t);
    if (n === 0) return this.cart({ ...f, checkout: undefined });
    const methods = this.d.settings.payMethods;
    let m: PayMethod | undefined = n ? methods[n - 1] : undefined;
    if (!m) {
      const w = t.toLowerCase();
      m = methods.find((x) =>
        x === 'pix'
          ? /pix/.test(w)
          : x === 'cash'
            ? /dinheiro|esp[eé]cie/.test(w)
            : x === 'credit'
              ? /cr[eé]dito/.test(w)
              : x === 'debit'
                ? /d[eé]bito/.test(w)
                : /vale|vr|va\b|ticket|alelo|sodexo/.test(w),
      );
    }
    if (!m) return this.retry(f, { text: payText(methods, f.mode ?? 'delivery'), flow: f });
    return this.advance({ ...f, pay: m, changeFor: m === 'cash' ? undefined : 0 });
  }

  private async onChange(f: Flow, t: string): Promise<FlowOut> {
    const total = subtotal(f.cart) + (f.mode === 'delivery' ? (f.fee ?? 0) : 0);
    if (choice(t) === 0 || /^(n[aã]o|nao preciso|sem troco|nada)/i.test(t.trim()))
      return this.advance({ ...f, changeFor: 0 });
    const v = amount(t);
    if (v === null) return { text: changeText(total), flow: f };
    if (v < total)
      return {
        text: `O valor precisa ser maior que o total (${b(money(total))}). Para quanto é o troco?`,
        flow: f,
      };
    return this.advance({ ...f, changeFor: v === total ? 0 : v });
  }

  private async onReview(f: Flow, t: string): Promise<FlowOut> {
    const n = choice(t);
    if (n === 0) return this.home(newFlow(), 'Pedido cancelado. 👍');
    if (n === 2)
      return this.cart(
        { ...f, checkout: undefined, pay: undefined, changeFor: undefined },
        '✏️ Sem problema! Mexa na sacola e depois feche de novo.',
      );
    if (n !== 1 && !/^(sim|confirmo|confirmar|pode mandar|fechado|isso)$/i.test(t.trim()))
      return {
        text: `Mande ${num(1)} para confirmar, ${num(2)} para mudar ou ${num(0)} para cancelar.`,
        flow: f,
      };
    const st = await this.d.store();
    if (!st.open)
      return this.home(newFlow(), `🔴 ${b('A loja fechou')} e não dá para pedir agora. 😕`);
    let r;
    try {
      r = await this.d.place(f);
    } catch (e) {
      const msg = (e as Error).message || 'não deu certo agora';
      return {
        text: [
          `😕 Não consegui fazer o pedido: ${i(msg)}`,
          '',
          options(['✏️ Mudar o pedido', '🙋 Falar com uma pessoa']),
        ].join('\n'),
        flow: { ...f, at: 'cart', checkout: undefined },
      };
    }
    const lines = [
      `🎉 ${b(`Pedido #${r.number} recebido!`)}`,
      '',
      `${STATUS_DOT[r.status] ?? '🟡'} Situação: ${i(orderStatusText({ status: r.status, channel: f.mode ?? 'delivery' }))}`,
      `💰 Total: ${b(money(r.total))}`,
    ];
    if (f.mode === 'delivery' && st.eta) lines.push(`⏱️ Previsão: ${st.eta}`);
    if (r.trackUrl && this.d.settings.sendTracking)
      lines.push('', `Acompanhe por aqui: ${r.trackUrl}`);
    lines.push(
      '',
      quote(`Para saber como está, mande ${b('menu')} e depois ${num(2)}. Obrigado! 🧡`),
    );
    const keep: Flow = {
      at: 'home',
      cart: [],
      customerId: f.customerId,
      name: f.name,
      placed: String(r.number),
    };
    return { text: lines.join('\n'), flow: keep, placed: r.number };
  }

  /** Resposta que não serviu: repete a tela com um aviso curto. */
  private retry(f: Flow, screen: FlowOut): FlowOut {
    return screen.text
      ? { ...screen, text: `Não entendi 🤔\n\n${screen.text}` }
      : { ...screen, flow: screen.flow ?? f };
  }
}

const BACK_LINE = `${num(0)} Voltar`;

/** Para testes e para a tela: o resumo da sacola numa linha. */
export const cartSummary = (f: Flow) => `${cartCount(f.cart)} itens · ${money(subtotal(f.cart))}`;
