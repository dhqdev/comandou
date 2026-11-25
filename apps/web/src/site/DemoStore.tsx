import {
  ArrowLeft,
  ArrowRight,
  Bike,
  Check,
  ChefHat,
  Clock,
  Minus,
  Plus,
  ShoppingBag,
  Store,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Mascot } from '../design-system';
import { brl } from '../lib/money';
import {
  DEMO_CATEGORIES,
  DEMO_FEATURED,
  DEMO_GROUPS,
  DEMO_ITEMS,
  DEMO_KITCHEN,
  DEMO_STAGES,
  DEMO_STORE,
  type DemoItem,
  type DemoStage,
} from './demo-data';
import { goTo, SiteLink } from './fx';
import { calmMotion } from './motion';
import './demo.css';

/**
 * Lanchonete de demonstração (comandou.com/demo): o cardápio da Fumaça Burger como o cliente vê,
 * com sacola, escolhas obrigatórias e pagamento, e ao lado (no celular, na aba Cozinha) o mesmo
 * pedido chegando no painel da equipe. Aceitar, pronto e despachar andam sozinhos ou no toque.
 * Nada sai do navegador: é tudo de mentira, para testar sem cadastro.
 */

const money = (n: number) => brl(n.toFixed(2));

interface Line {
  id: number;
  item: DemoItem;
  qty: number;
  /** Escolhas por grupo (nomes das opções). */
  picks: Record<string, string[]>;
  note: string;
  /** Preço de uma unidade com as escolhas. */
  unit: number;
}

interface Order {
  n: string;
  lines: Line[];
  total: number;
  mode: 'delivery' | 'pickup';
  pay: 'pix' | 'card' | 'cash';
  stage: DemoStage;
  at: number;
  changedAt: number;
}

const PAY_LABEL = { pix: 'Pix', card: 'Cartão na entrega', cash: 'Dinheiro' } as const;

/** Tempo até o próximo passo quando ninguém aperta nada (ms). */
const AUTO: Record<DemoStage, number> = {
  new: 6000,
  cook: 9000,
  ready: 6000,
  route: 9000,
  done: 0,
};

function nextStage(o: Order): DemoStage | null {
  if (o.stage === 'new') return 'cook';
  if (o.stage === 'cook') return 'ready';
  if (o.stage === 'ready') return o.mode === 'pickup' ? 'done' : 'route';
  if (o.stage === 'route') return 'done';
  return null;
}

function stageLabel(o: Order, key: DemoStage = o.stage) {
  if (o.mode === 'pickup' && key === 'done') return 'Retirado';
  if (o.mode === 'pickup' && key === 'ready') return 'Pronto para retirar';
  return DEMO_STAGES.find((s) => s.key === key)!.label;
}

function actionLabel(o: Order) {
  if (o.stage === 'ready' && o.mode === 'pickup') return 'Entregar ao cliente';
  return DEMO_STAGES.find((s) => s.key === o.stage)!.action;
}

const picksText = (l: Line) =>
  Object.values(l.picks)
    .flat()
    .concat(l.note ? [`“${l.note}”`] : [])
    .join(' · ');

const itemsText = (o: Order) =>
  o.lines.map((l) => `${l.qty > 1 ? `${l.qty}× ` : ''}${l.item.name}`).join(', ');

/** `<dialog>` com entrada e saída: folha que sobe de baixo no celular, janela no computador. */
function Sheet({
  open,
  onClose,
  label,
  className = '',
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      setMounted(true);
      if (!d.open) d.showModal();
      const id = requestAnimationFrame(() => d.classList.add('is-in'));
      return () => cancelAnimationFrame(id);
    }
    if (!d.open) return;
    d.classList.remove('is-in');
    const t = window.setTimeout(
      () => {
        d.close();
        setMounted(false);
      },
      calmMotion() ? 0 : 200,
    );
    return () => window.clearTimeout(t);
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dm-sheet ${className}`}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={(e) => {
        // Fechou por fora (o navegador fecha no segundo Esc): o estado acompanha.
        if (e.target === e.currentTarget && open) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {mounted && <div className="dm-sheet__in">{children}</div>}
    </dialog>
  );
}

function Stepper({
  value,
  onChange,
  min = 0,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  label: string;
}) {
  return (
    <span className="dm-step" role="group" aria-label={label}>
      <button
        type="button"
        aria-label="Menos um"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min && min > 0}
      >
        <Minus size={16} strokeWidth={2.4} aria-hidden />
      </button>
      <b aria-live="polite">{value}</b>
      <button type="button" aria-label="Mais um" onClick={() => onChange(Math.min(20, value + 1))}>
        <Plus size={16} strokeWidth={2.4} aria-hidden />
      </button>
    </span>
  );
}

/** Tela do item: foto grande, escolhas (obrigatórias primeiro), observação e quantidade. */
function ItemSheet({
  item,
  onClose,
  onAdd,
}: {
  item: DemoItem | null;
  onClose: () => void;
  onAdd: (l: Omit<Line, 'id'>) => void;
}) {
  const [shown, setShown] = useState<DemoItem | null>(item);
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState('');
  const [qty, setQty] = useState(1);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!item) return;
    setShown(item);
    setPicks({});
    setNote('');
    setQty(1);
  }, [item]);
  const it = item ?? shown;
  const groups = (it?.groups ?? []).map((k) => DEMO_GROUPS[k]!).filter(Boolean);
  const extra = groups.reduce(
    (s, g) =>
      s +
      (picks[g.key] ?? []).reduce(
        (a, name) => a + (g.options.find((o) => o.name === name)?.price ?? 0),
        0,
      ),
    0,
  );
  const unit = (it?.price ?? 0) + extra;
  const missing = groups.find((g) => (picks[g.key]?.length ?? 0) < g.min);

  const toggle = (key: string, name: string, max: number) =>
    setPicks((p) => {
      const cur = p[key] ?? [];
      if (max === 1) return { ...p, [key]: [name] };
      if (cur.includes(name)) return { ...p, [key]: cur.filter((n) => n !== name) };
      if (cur.length >= max) return p;
      return { ...p, [key]: [...cur, name] };
    });

  const add = () => {
    if (!it) return;
    if (missing) {
      body.current
        ?.querySelector(`[data-group="${missing.key}"]`)
        ?.scrollIntoView({ behavior: calmMotion() ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    onAdd({ item: it, qty, picks, note: note.trim(), unit });
  };

  return (
    <Sheet open={!!item} onClose={onClose} label={it?.name ?? 'Item'} className="dm-item">
      {it && (
        <>
          <div className="dm-item__body" ref={body}>
            <div className="dm-item__pic">
              <img src={`/site/food/${it.img}.webp`} alt={it.name} width={640} height={480} />
              <button type="button" className="dm-x" aria-label="Fechar" onClick={onClose}>
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="dm-item__head">
              <h2>{it.name}</h2>
              <p>{it.desc}</p>
              <strong>{money(it.price)}</strong>
            </div>
            {groups.map((g) => {
              const chosen = picks[g.key] ?? [];
              const ok = chosen.length >= g.min;
              return (
                <fieldset key={g.key} className="dm-group" data-group={g.key}>
                  <legend>
                    <span>
                      <b>{g.name}</b>
                      <small>
                        {g.max === 1
                          ? 'Escolha 1'
                          : g.min
                            ? `Escolha de ${g.min} a ${g.max}`
                            : `Até ${g.max}${chosen.length ? ` · ${chosen.length}/${g.max}` : ''}`}
                      </small>
                    </span>
                    {g.min > 0 && (
                      <em className={ok ? 'is-ok' : ''}>
                        {ok ? (
                          <Check size={13} strokeWidth={3} aria-label="Feito" />
                        ) : (
                          'Obrigatório'
                        )}
                      </em>
                    )}
                  </legend>
                  {g.options.map((o) => {
                    const on = chosen.includes(o.name);
                    return (
                      <label key={o.name} className={`dm-opt ${on ? 'is-on' : ''}`}>
                        <input
                          type={g.max === 1 ? 'radio' : 'checkbox'}
                          name={`${it.key}-${g.key}`}
                          checked={on}
                          onChange={() => toggle(g.key, o.name, g.max)}
                        />
                        <span className="dm-opt__mark" aria-hidden>
                          {on && <Check size={12} strokeWidth={3.2} />}
                        </span>
                        <span className="dm-opt__text">
                          {o.name}
                          {o.desc && <small>{o.desc}</small>}
                        </span>
                        {o.price > 0 && <span className="dm-opt__price">+ {money(o.price)}</span>}
                      </label>
                    );
                  })}
                </fieldset>
              );
            })}
            <label className="dm-note">
              <span>Alguma observação?</span>
              <textarea
                rows={2}
                maxLength={140}
                placeholder="Ex.: sem cebola, maionese à parte"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>
          <div className="dm-item__foot">
            <Stepper value={qty} onChange={setQty} min={1} label="Quantidade" />
            <button type="button" className="dm-cta" onClick={add}>
              {missing ? (
                <span>Escolha {missing.name.toLowerCase()}</span>
              ) : (
                <>
                  <span>Adicionar</span>
                  <b>{money(unit * qty)}</b>
                </>
              )}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/** Situação do pedido para o cliente: cinco passos, o atual em destaque. */
function Tracker({ order, onKitchen }: { order: Order; onKitchen?: () => void }) {
  const keys: DemoStage[] =
    order.mode === 'pickup' ? ['new', 'cook', 'ready', 'done'] : DEMO_STAGES.map((s) => s.key);
  const at = keys.indexOf(order.stage);
  const info = DEMO_STAGES.find((s) => s.key === order.stage)!;
  return (
    <section className="dm-track" aria-live="polite" data-stage={order.stage}>
      <div className="dm-track__top">
        <span className="dm-track__ic" aria-hidden>
          {order.stage === 'done' ? (
            <Check size={18} strokeWidth={2.6} />
          ) : order.stage === 'route' ? (
            <Bike size={18} />
          ) : order.stage === 'new' ? (
            <Clock size={18} />
          ) : (
            <ChefHat size={18} />
          )}
        </span>
        <div>
          <small>Pedido #{order.n}</small>
          <strong key={order.stage}>{stageLabel(order)}</strong>
        </div>
        {onKitchen && (
          <button type="button" className="dm-link" onClick={onKitchen}>
            Ver na cozinha
            <ArrowRight size={14} aria-hidden />
          </button>
        )}
      </div>
      <ol className="dm-track__bar" aria-hidden>
        {keys.map((k, i) => (
          <li key={k} className={i < at ? 'is-done' : i === at ? 'is-now' : ''} />
        ))}
      </ol>
      <p>
        {order.mode === 'pickup' && order.stage === 'ready'
          ? 'Pode vir buscar: está no balcão.'
          : order.mode === 'pickup' && order.stage === 'done'
            ? 'Retirado no balcão. Bom apetite!'
            : info.text}{' '}
        <span className="dm-track__sum">
          {itemsText(order)} · {money(order.total)} · {PAY_LABEL[order.pay]}
        </span>
      </p>
    </section>
  );
}

const since = (t: number, now: number) => {
  const m = Math.floor((now - t) / 60000);
  return m < 1 ? 'agora' : `${m} min`;
};

/** Painel da cozinha: os pedidos que já estavam lá e os da pessoa, com o botão do próximo passo. */
function Kitchen({
  orders,
  onAdvance,
  now,
}: {
  orders: Order[];
  onAdvance: (n: string) => void;
  now: number;
}) {
  const mine = orders.filter((o) => o.stage !== 'done');
  const cols: { key: string; label: string; stages: string[] }[] = [
    { key: 'new', label: 'Novos', stages: ['new'] },
    { key: 'cook', label: 'Em preparo', stages: ['cook'] },
    { key: 'ready', label: 'Prontos e saindo', stages: ['ready', 'route'] },
  ];
  return (
    <div className="dm-kds">
      <div className="dm-kds__head">
        <span className="dm-kds__title">
          <ChefHat size={18} aria-hidden />
          <strong>Cozinha</strong>
        </span>
        <span className="dm-live">
          <i /> Ao vivo
        </span>
      </div>
      <p className="dm-kds__hint">
        É assim que a equipe vê os pedidos. Faça um pedido na loja e aperte os botões para o cliente
        acompanhar.
      </p>
      {cols.map((c) => {
        const own = mine.filter((o) => c.stages.includes(o.stage));
        const seed = DEMO_KITCHEN.filter((k) => c.stages.includes(k.stage));
        return (
          <div key={c.key} className="dm-kds__col">
            <h3>
              {c.label} <em>{own.length + seed.length}</em>
            </h3>
            {own.length + seed.length === 0 && <p className="dm-kds__empty">Nada aqui agora.</p>}
            <ul>
              {own.map((o) => (
                <li key={o.n} className="dm-ticket is-mine" data-stage={o.stage}>
                  <div className="dm-ticket__top">
                    <span
                      className="dm-ch"
                      style={{ '--hue': 'var(--cm-tint-teal)' } as CSSProperties}
                    >
                      Cardápio online
                    </span>
                    <span className="dm-ticket__you">Seu pedido</span>
                    <span className="dm-ticket__time">{since(o.at, now)}</span>
                  </div>
                  <strong>
                    #{o.n} · {o.mode === 'pickup' ? 'Retirada' : 'Entrega'}
                  </strong>
                  <ul className="dm-ticket__lines">
                    {o.lines.map((l) => (
                      <li key={l.id}>
                        <b>{l.qty}×</b> {l.item.name}
                        {picksText(l) && <small>{picksText(l)}</small>}
                      </li>
                    ))}
                  </ul>
                  <div className="dm-ticket__foot">
                    <span className="dm-st" data-stage={o.stage}>
                      {stageLabel(o)}
                    </span>
                    <button
                      type="button"
                      className="dm-cta dm-cta--sm"
                      onClick={() => onAdvance(o.n)}
                    >
                      {actionLabel(o)}
                    </button>
                  </div>
                </li>
              ))}
              {seed.map((k) => (
                <li key={k.n} className="dm-ticket" data-stage={k.stage}>
                  <div className="dm-ticket__top">
                    <span
                      className="dm-ch"
                      style={{ '--hue': `var(--cm-tint-${k.hue})` } as CSSProperties}
                    >
                      {k.ch}
                    </span>
                    <span className="dm-ticket__time">{k.min} min</span>
                  </div>
                  <strong>#{k.n}</strong>
                  <small className="dm-ticket__items">{k.items}</small>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function DemoStore() {
  const [view, setView] = useState<'store' | 'kitchen'>('store');
  const [bag, setBag] = useState<Line[]>([]);
  const [item, setItem] = useState<DemoItem | null>(null);
  const [bagOpen, setBagOpen] = useState(false);
  const [step, setStep] = useState<'bag' | 'pay'>('bag');
  const [mode, setMode] = useState<'delivery' | 'pickup'>('delivery');
  const [pay, setPay] = useState<Order['pay']>('pix');
  const [orders, setOrders] = useState<Order[]>([]);
  const [cat, setCat] = useState(DEMO_CATEGORIES[0]!.key);
  const [bump, setBump] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const seq = useRef(1);
  const tabs = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = `${DEMO_STORE.name} · Lanchonete de demonstração do Comandou`;
    window.scrollTo(0, 0);
  }, []);

  // Relógio dos tempos da cozinha e dos passos que andam sozinhos.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    setOrders((list) => {
      let changed = false;
      const out = list.map((o) => {
        const next = nextStage(o);
        if (!next || now - o.changedAt < AUTO[o.stage]) return o;
        changed = true;
        return { ...o, stage: next, changedAt: now };
      });
      return changed ? out : list;
    });
  }, [now]);

  // A aba da categoria acompanha a rolagem.
  useEffect(() => {
    if (view !== 'store' || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setCat((top.target as HTMLElement).dataset.cat ?? DEMO_CATEGORIES[0]!.key);
      },
      { rootMargin: '-140px 0px -60% 0px' },
    );
    document.querySelectorAll('[data-cat]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [view]);
  useEffect(() => {
    tabs.current
      ?.querySelector<HTMLElement>(`[data-tab="${cat}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [cat]);

  const count = bag.reduce((s, l) => s + l.qty, 0);
  const subtotal = bag.reduce((s, l) => s + l.unit * l.qty, 0);
  const fee = mode === 'delivery' ? DEMO_STORE.fee : 0;
  const total = subtotal + fee;
  const belowMin = mode === 'delivery' && subtotal < DEMO_STORE.minOrder;
  const active = orders.find((o) => o.stage !== 'done') ?? orders[orders.length - 1];

  const featured = useMemo(
    () => DEMO_FEATURED.map((k) => DEMO_ITEMS.find((i) => i.key === k)!).filter(Boolean),
    [],
  );

  const add = (l: Omit<Line, 'id'>) => {
    setBag((b) => [...b, { ...l, id: seq.current++ }]);
    setItem(null);
    setBump((n) => n + 1);
  };

  const setQty = (id: number, qty: number) =>
    setBag((b) =>
      qty <= 0 ? b.filter((l) => l.id !== id) : b.map((l) => (l.id === id ? { ...l, qty } : l)),
    );

  const place = () => {
    const t = Date.now();
    const n = String(1042 + orders.length + 1);
    setOrders((list) => [
      ...list,
      { n, lines: bag, total, mode, pay, stage: 'new', at: t, changedAt: t },
    ]);
    setBag([]);
    setBagOpen(false);
    setStep('bag');
    window.scrollTo({ top: 0, behavior: calmMotion() ? 'auto' : 'smooth' });
  };

  const advance = (n: string) =>
    setOrders((list) =>
      list.map((o) => {
        if (o.n !== n) return o;
        const next = nextStage(o);
        return next ? { ...o, stage: next, changedAt: Date.now() } : o;
      }),
    );

  const jump = (key: string) => {
    setCat(key);
    const el = document.getElementById(`dm-${key}`);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 128;
    window.scrollTo({ top: y, behavior: calmMotion() ? 'auto' : 'smooth' });
  };

  return (
    <div className="dm" data-view={view}>
      <header className="dm-top">
        <SiteLink to="/" className="dm-top__back" aria-label="Voltar ao site do Comandou">
          <ArrowLeft size={18} aria-hidden />
          <Mascot size={24} badge />
          <span>Comandou</span>
        </SiteLink>
        <span className="dm-top__pill">Loja de demonstração</span>
        <div className="dm-top__end">
          <div className="dm-views" role="tablist" aria-label="O que ver">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'store'}
              className={view === 'store' ? 'is-on' : ''}
              onClick={() => setView('store')}
            >
              <Store size={15} aria-hidden /> Cliente
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'kitchen'}
              className={view === 'kitchen' ? 'is-on' : ''}
              onClick={() => {
                setView('kitchen');
                window.scrollTo(0, 0);
              }}
            >
              <ChefHat size={15} aria-hidden /> Cozinha
              {orders.some((o) => o.stage === 'new') && <i className="dm-views__dot" />}
            </button>
          </div>
          <button type="button" className="dm-top__cta" onClick={() => goTo('/#criar')}>
            Criar a minha loja
          </button>
        </div>
      </header>

      <div className="dm-wrap">
        <main className="dm-store">
          <div className="dm-cover">
            <img src={DEMO_STORE.cover} alt="" width={1280} height={560} />
          </div>
          <div className="dm-id">
            <img className="dm-id__logo" src={DEMO_STORE.logo} alt="" width={96} height={96} />
            <div>
              <h1>{DEMO_STORE.name}</h1>
              <p>{DEMO_STORE.headline}</p>
              <ul className="dm-id__meta">
                <li className="dm-open">
                  <i /> Aberto agora
                </li>
                <li>{DEMO_STORE.eta}</li>
                <li>Entrega {money(DEMO_STORE.fee)}</li>
                <li>Mínimo {money(DEMO_STORE.minOrder)}</li>
              </ul>
            </div>
          </div>

          {active && <Tracker order={active} onKitchen={() => setView('kitchen')} />}

          <div className="dm-tabs" ref={tabs} role="tablist" aria-label="Categorias">
            {DEMO_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                data-tab={c.key}
                aria-selected={cat === c.key}
                className={cat === c.key ? 'is-on' : ''}
                onClick={() => jump(c.key)}
              >
                {c.name}
              </button>
            ))}
          </div>

          <section className="dm-feat" aria-label="Os queridinhos da casa">
            <h2>Os queridinhos da casa</h2>
            <div className="dm-feat__row">
              {featured.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  className="dm-feat__card"
                  onClick={() => setItem(it)}
                >
                  <span className="dm-feat__pic">
                    <img
                      src={`/site/food/${it.img}.webp`}
                      alt=""
                      width={640}
                      height={480}
                      loading="lazy"
                    />
                    {it.badge && <em>{it.badge}</em>}
                  </span>
                  <strong>{it.name}</strong>
                  <span className="dm-feat__price">
                    {money(it.price)}
                    <i aria-hidden>
                      <Plus size={14} strokeWidth={2.6} />
                    </i>
                  </span>
                </button>
              ))}
            </div>
          </section>

          {DEMO_CATEGORIES.map((c) => (
            <section key={c.key} id={`dm-${c.key}`} data-cat={c.key} className="dm-cat">
              <h2>{c.name}</h2>
              <ul className="dm-list">
                {DEMO_ITEMS.filter((i) => i.cat === c.key).map((it) => (
                  <li key={it.key}>
                    <button type="button" className="dm-row" onClick={() => setItem(it)}>
                      <span className="dm-row__text">
                        <strong>{it.name}</strong>
                        <span>{it.desc}</span>
                        <b>
                          {money(it.price)}
                          {it.badge && <em>{it.badge}</em>}
                        </b>
                      </span>
                      <span className="dm-row__pic">
                        <img
                          src={`/site/food/${it.img}-sm.webp`}
                          alt=""
                          width={240}
                          height={180}
                          loading="lazy"
                        />
                        <i aria-hidden>
                          <Plus size={14} strokeWidth={2.6} />
                        </i>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <footer className="dm-end">
            <Mascot size={44} />
            <h2>Gostou? A sua loja fica assim.</h2>
            <p>Cardápio, sacola, pagamento e o pedido caindo na cozinha. Tudo pronto em minutos.</p>
            <button type="button" className="dm-cta dm-cta--wide" onClick={() => goTo('/#criar')}>
              Criar a minha loja grátis
              <ArrowRight size={16} aria-hidden />
            </button>
            <small>
              Loja de demonstração do Comandou. Fotos do Unsplash; nenhum pedido é de verdade.
            </small>
          </footer>
        </main>

        <aside className="dm-side" aria-label="Painel da cozinha">
          <Kitchen orders={orders} onAdvance={advance} now={now} />
          {view === 'kitchen' && active && (
            <button type="button" className="dm-back" onClick={() => setView('store')}>
              <ArrowLeft size={15} aria-hidden /> Voltar para a loja
            </button>
          )}
        </aside>
      </div>

      {count > 0 && view === 'store' && (
        <button
          type="button"
          className="dm-bagbar"
          onClick={() => {
            setStep('bag');
            setBagOpen(true);
          }}
        >
          <span className="dm-bagbar__ic" key={bump}>
            <ShoppingBag size={18} aria-hidden />
            <i>{count}</i>
          </span>
          <span>Ver sacola</span>
          <b>{money(subtotal)}</b>
        </button>
      )}

      <ItemSheet item={item} onClose={() => setItem(null)} onAdd={add} />

      <Sheet open={bagOpen} onClose={() => setBagOpen(false)} label="Sacola" className="dm-bag">
        <div className="dm-bag__head">
          {step === 'pay' ? (
            <button
              type="button"
              className="dm-x dm-x--plain"
              aria-label="Voltar"
              onClick={() => setStep('bag')}
            >
              <ArrowLeft size={18} aria-hidden />
            </button>
          ) : (
            <span />
          )}
          <h2>{step === 'bag' ? 'Sua sacola' : 'Pagamento'}</h2>
          <button
            type="button"
            className="dm-x dm-x--plain"
            aria-label="Fechar"
            onClick={() => setBagOpen(false)}
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        {step === 'bag' ? (
          <div className="dm-bag__body" key="bag">
            <ul className="dm-lines">
              {bag.map((l) => (
                <li key={l.id}>
                  <img src={`/site/food/${l.item.img}-sm.webp`} alt="" width={240} height={180} />
                  <div>
                    <strong>{l.item.name}</strong>
                    {picksText(l) && <small>{picksText(l)}</small>}
                    <b>{money(l.unit * l.qty)}</b>
                  </div>
                  <Stepper
                    value={l.qty}
                    onChange={(q) => setQty(l.id, q)}
                    label={`Quantidade de ${l.item.name}`}
                  />
                </li>
              ))}
              {bag.length === 0 && <li className="dm-lines__empty">A sacola está vazia.</li>}
            </ul>
            <div className="dm-seg" role="radiogroup" aria-label="Como receber">
              {(['delivery', 'pickup'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  className={mode === m ? 'is-on' : ''}
                  onClick={() => setMode(m)}
                >
                  {m === 'delivery' ? (
                    <Bike size={15} aria-hidden />
                  ) : (
                    <Store size={15} aria-hidden />
                  )}
                  {m === 'delivery' ? 'Entrega' : 'Retirar na loja'}
                </button>
              ))}
            </div>
            <dl className="dm-sum">
              <div>
                <dt>Subtotal</dt>
                <dd>{money(subtotal)}</dd>
              </div>
              <div>
                <dt>{mode === 'delivery' ? `Entrega · ${DEMO_STORE.eta}` : 'Retirada na loja'}</dt>
                <dd>{fee ? money(fee) : 'Grátis'}</dd>
              </div>
              <div className="dm-sum__total">
                <dt>Total</dt>
                <dd>{money(total)}</dd>
              </div>
            </dl>
            {belowMin && (
              <p className="dm-warn">
                O pedido mínimo para entrega é {money(DEMO_STORE.minOrder)}. Falta{' '}
                {money(DEMO_STORE.minOrder - subtotal)}.
              </p>
            )}
            <button
              type="button"
              className="dm-cta dm-cta--wide"
              disabled={!bag.length || belowMin}
              onClick={() => setStep('pay')}
            >
              <span>Continuar</span>
              <b>{money(total)}</b>
            </button>
          </div>
        ) : (
          <div className="dm-bag__body" key="pay">
            <div className="dm-pay" role="radiogroup" aria-label="Forma de pagamento">
              {(['pix', 'card', 'cash'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={pay === p}
                  className={pay === p ? 'is-on' : ''}
                  onClick={() => setPay(p)}
                >
                  <span className="dm-opt__mark" aria-hidden>
                    {pay === p && <Check size={12} strokeWidth={3.2} />}
                  </span>
                  <span>
                    <strong>{PAY_LABEL[p]}</strong>
                    <small>
                      {p === 'pix'
                        ? 'Aprovado na hora, sem sair da loja'
                        : p === 'card'
                          ? 'O entregador leva a maquininha'
                          : 'Diga se precisa de troco'}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <dl className="dm-sum">
              <div className="dm-sum__total">
                <dt>{mode === 'delivery' ? 'Total com a entrega' : 'Total'}</dt>
                <dd>{money(total)}</dd>
              </div>
            </dl>
            <p className="dm-note-text">É uma demonstração: nada é cobrado e nada sai daqui.</p>
            <button type="button" className="dm-cta dm-cta--wide" onClick={place}>
              <span>Fazer pedido</span>
              <b>{money(total)}</b>
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
