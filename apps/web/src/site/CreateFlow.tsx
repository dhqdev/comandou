import {
  ArrowRight,
  Bike,
  Check,
  ChefHat,
  Copy,
  Lock,
  Monitor,
  ShoppingBag,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Alert, Button, Mascot, TextField } from '../design-system';
import { calmMotion } from './motion';
import { slugPreview } from './site-data';

/**
 * Janela de criar o restaurante, em tela cheia: à esquerda a loja nascendo (endereço, capa, nome e
 * os módulos acendendo um a um); à direita os dados, os passos enquanto cria e, no fim, o login.
 * A transição acompanha o servidor: os passos andam com o tempo e com cada consulta, mas "pronto"
 * só aparece quando a API diz que o restaurante está no ar (e depois de ver a loja montar).
 */
export interface TrialForm {
  restaurant: string;
  name: string;
  email: string;
  phone: string;
  /** Campo escondido contra robôs. */
  company: string;
}

export interface Created {
  token: string;
  entry: string;
  slug: string;
  url: string;
  email: string;
  password: string;
  trialDays: number;
  trialEndsAt: string;
  emailOn: boolean;
}

export type CreateState = 'creating' | 'ready' | 'failed' | 'slow';

type Phase = 'form' | 'build' | 'ready' | 'failed';

const BUILD_STEPS = [
  'Reservando o seu endereço',
  'Montando cardápio, PDV, cozinha e caixa',
  'Criando o seu login',
  'Abrindo as portas',
];

/** Os módulos que acendem na loja enquanto ela nasce. */
const MODS: { label: string; icon: LucideIcon }[] = [
  { label: 'Cardápio', icon: ShoppingBag },
  { label: 'PDV e caixa', icon: Monitor },
  { label: 'Cozinha', icon: ChefHat },
  { label: 'Delivery', icon: Bike },
];

/** Tempo mínimo vendo a loja montar, mesmo quando o servidor é mais rápido. */
const MIN_BUILD_MS = 2600;

/** (11) 99999-8888 enquanto a pessoa digita. */
function maskPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  const cut = d.length > 10 ? 7 : 6;
  return `(${d.slice(0, 2)}) ${d.slice(2, cut)}-${d.slice(cut)}`;
}

const EMAIL = /^\S+@\S+\.\S+$/;

function problems(f: TrialForm) {
  return {
    restaurant: f.restaurant.trim().length >= 2 ? null : 'Escreva o nome do restaurante.',
    name: f.name.trim().length >= 2 ? null : 'Escreva o seu nome.',
    email: EMAIL.test(f.email.trim()) ? null : 'Confira o e-mail: falta alguma parte.',
  };
}

/** Abre e fecha o `<dialog>` com a entrada e a saída do CSS (`is-in`). */
function useDialog(open: boolean) {
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
      calmMotion() ? 0 : 180,
    );
    return () => window.clearTimeout(t);
  }, [open]);
  return { ref, mounted };
}

export function CreateFlow({
  open,
  onClose,
  form,
  onForm,
  busy,
  error,
  onSubmit,
  created,
  state,
  tick,
  reachable,
  onEnter,
  onRetry,
  look,
  trialDays,
}: {
  open: boolean;
  /** `force`: o navegador já fechou a janela (Esc duas vezes); fecha mesmo criando. */
  onClose: (force?: boolean) => void;
  form: TrialForm;
  /** `byHand`: a pessoa escreveu o nome (a prévia do site não troca mais). */
  onForm: (f: TrialForm, byHand?: boolean) => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  created: Created | null;
  state: CreateState;
  tick: number;
  reachable: boolean;
  onEnter: () => void;
  onRetry: () => void;
  look: { color: string | null; icon: string | null; cover: string | null };
  trialDays: number;
}) {
  const { ref, mounted } = useDialog(open);
  const titleId = useId();
  const [tried, setTried] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [buildAt, setBuildAt] = useState<number | null>(null);

  const real: Phase = !created
    ? 'form'
    : state === 'ready'
      ? 'ready'
      : state === 'failed'
        ? 'failed'
        : 'build';
  // Começou a montar: guarda a hora, para a loja montar inteira antes de dizer "pronto".
  useEffect(() => {
    if (real === 'form') setBuildAt(null);
    else if (buildAt === null) {
      const t = Date.now();
      setBuildAt(t);
      setNow(t);
    }
  }, [real, buildAt]);
  const elapsed = buildAt === null ? 0 : Math.max(0, now - buildAt);
  const phase: Phase = real === 'ready' && elapsed < MIN_BUILD_MS && !calmMotion() ? 'build' : real;

  // Relógio da montagem (só enquanto monta).
  useEffect(() => {
    if (phase !== 'build') return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [phase]);

  // Passos: andam com o tempo e com as consultas; o último espera o servidor.
  const byTime = Math.floor(elapsed / 650);
  const byPoll = Math.floor(tick / 2);
  const step =
    phase === 'ready'
      ? BUILD_STEPS.length
      : Math.min(BUILD_STEPS.length - 1, Math.max(byTime, byPoll));
  const lit =
    phase === 'ready' ? MODS.length : phase === 'build' ? Math.min(MODS.length, step + 1) : 0;

  const issues = problems(form);
  const valid = !issues.restaurant && !issues.name && !issues.email;
  const show = (k: keyof typeof issues) => (tried ? (issues[k] ?? undefined) : undefined);

  // Abriu no computador: o cursor já vai para o primeiro campo vazio.
  const firstField = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || phase !== 'form' || !window.matchMedia('(pointer: fine)').matches) return;
    const t = window.setTimeout(() => {
      const inputs = [...(firstField.current?.querySelectorAll('input') ?? [])];
      (inputs.find((i) => !i.value && i.type !== 'hidden') ?? inputs[0])?.focus();
    }, 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) setTried(false);
  }, [open]);

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    setTried(true);
    if (!valid || busy) {
      const bad = ['restaurant', 'name', 'email'].find((k) => issues[k as keyof typeof issues]);
      firstField.current?.querySelector<HTMLInputElement>(`[name="${bad}"]`)?.focus();
      return;
    }
    onSubmit();
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(
        `${created.url}\nLogin: ${created.email}\nSenha: ${created.password}`,
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* sem permissão de copiar: os dados estão na tela */
    }
  };

  const base = window.location.host.replace(/^www\./, '');
  const slug = created?.slug ?? slugPreview(form.restaurant);
  const name = form.restaurant.trim() || 'Seu restaurante';
  const initial = name[0]?.toUpperCase() ?? 'S';
  const free =
    trialDays > 0 ? `${trialDays} ${trialDays === 1 ? 'dia' : 'dias'} grátis` : 'Teste grátis';
  const closable = !busy;

  return (
    <dialog
      ref={ref}
      className="st-create"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (closable) onClose();
      }}
      onClose={(e) => {
        // Fechou por fora (o navegador fecha no segundo Esc): o estado acompanha.
        if (e.target === e.currentTarget && open) onClose(true);
      }}
    >
      {mounted && (
        <div className="st-create__in" data-phase={phase}>
          <header className="st-create__top">
            <span className="st-brand">
              <Mascot size={26} badge />
              <span>Comandou</span>
            </span>
            <ol className="st-create__track" aria-hidden>
              {['Seus dados', 'Montando', 'No ar'].map((t, i) => {
                const at = phase === 'form' ? 0 : phase === 'ready' ? 2 : 1;
                return (
                  <li key={t} className={i < at ? 'is-done' : i === at ? 'is-now' : ''}>
                    <i />
                    {t}
                  </li>
                );
              })}
            </ol>
            <button
              type="button"
              className="st-icon st-create__x"
              aria-label="Fechar"
              onClick={() => closable && onClose()}
            >
              <X size={20} aria-hidden />
            </button>
          </header>

          <div className="st-create__body">
            <aside className="st-create__show" aria-hidden>
              <div
                className="st-forge"
                data-phase={phase}
                style={look.color ? ({ '--st-brand': look.color } as CSSProperties) : undefined}
              >
                <div className="st-forge__bar">
                  <span className="st-forge__dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="st-forge__url">
                    <Lock size={11} strokeWidth={2.4} className="st-forge__lock" />
                    <span>
                      <b key={slug}>{slug || 'seu-restaurante'}</b>.{base}
                    </span>
                  </span>
                  <i className="st-forge__load" />
                </div>
                <div className="st-forge__page">
                  <div
                    className="st-forge__cover"
                    style={{ backgroundImage: `url(${look.cover ?? '/site/food/capa.webp'})` }}
                  />
                  <div className="st-forge__head">
                    <span className="st-forge__logo">
                      {look.icon ? <img src={look.icon} alt="" /> : initial}
                    </span>
                    <span className="st-forge__id">
                      <strong key={name}>{name}</strong>
                      <small>
                        <i /> {phase === 'ready' ? 'Aberto agora' : 'Abrindo em instantes'}
                      </small>
                    </span>
                  </div>
                  <ul className="st-forge__mods">
                    {MODS.map((m, i) => (
                      <li key={m.label} data-on={i < lit || undefined}>
                        <m.icon size={17} strokeWidth={1.8} />
                        <span>{m.label}</span>
                        <Check size={13} strokeWidth={3} className="st-forge__ok" />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </aside>

            <section className="st-create__main">
              {phase === 'form' && (
                <form className="st-create__form" onSubmit={send} noValidate key="form">
                  <div className="st-create__head">
                    <h2 id={titleId}>Vamos criar o seu restaurante</h2>
                    <p>Leva menos de um minuto. {free}, sem cartão.</p>
                  </div>
                  {error && <Alert tone="danger">{error}</Alert>}
                  <div className="st-create__fields" ref={firstField}>
                    <div className="st-create__name">
                      <TextField
                        label="Nome do restaurante"
                        name="restaurant"
                        autoComplete="organization"
                        maxLength={80}
                        value={form.restaurant}
                        error={show('restaurant')}
                        onChange={(e) => onForm({ ...form, restaurant: e.target.value }, true)}
                      />
                      {slug && !show('restaurant') && (
                        <p className="st-create__addr">
                          Seu endereço: <b>{slug}</b>.{base}
                        </p>
                      )}
                    </div>
                    <TextField
                      label="Seu nome"
                      name="name"
                      autoComplete="name"
                      maxLength={120}
                      value={form.name}
                      error={show('name')}
                      onChange={(e) => onForm({ ...form, name: e.target.value })}
                    />
                    <TextField
                      label="E-mail"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      hint="O login e a senha chegam aqui."
                      maxLength={254}
                      value={form.email}
                      error={show('email')}
                      onChange={(e) => onForm({ ...form, email: e.target.value })}
                    />
                    <TextField
                      label="WhatsApp (opcional)"
                      name="phone"
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={20}
                      value={form.phone}
                      onChange={(e) => onForm({ ...form, phone: maskPhone(e.target.value) })}
                    />
                    {/* Campo que gente não vê nem preenche; robô preenche e o cadastro é recusado. */}
                    <input
                      className="st-hp"
                      tabIndex={-1}
                      autoComplete="off"
                      aria-hidden
                      value={form.company}
                      onChange={(e) => onForm({ ...form, company: e.target.value })}
                    />
                  </div>
                  <div className="st-create__foot">
                    <Button type="button" variant="ghost" onClick={() => onClose()} disabled={busy}>
                      Voltar
                    </Button>
                    <Button type="submit" size="lg" className="st-press st-arrow" loading={busy}>
                      Criar e abrir
                      {!busy && <ArrowRight size={18} aria-hidden className="st-arrow__i" />}
                    </Button>
                  </div>
                </form>
              )}

              {phase === 'build' && (
                <div className="st-create__build" key="build">
                  <div className="st-create__head">
                    <h2 id={titleId}>Criando o seu restaurante</h2>
                    <p>Isso leva alguns segundos. Pode deixar a janela aberta.</p>
                  </div>
                  <ol className="st-steps-live" aria-live="polite">
                    {BUILD_STEPS.map((s, i) => (
                      <li key={s} className={i < step ? 'is-done' : i === step ? 'is-now' : ''}>
                        <span className="st-steps-live__dot">
                          {i < step ? (
                            <Check size={13} strokeWidth={3} aria-hidden />
                          ) : i === step ? (
                            <i className="st-ring" aria-hidden />
                          ) : null}
                        </span>
                        {s}
                      </li>
                    ))}
                    {state === 'slow' && (
                      <li className="st-steps-live__slow">
                        Está demorando mais que o normal. Pode fechar: o login chega no seu e-mail
                        quando ficar pronto.
                      </li>
                    )}
                  </ol>
                </div>
              )}

              {phase === 'ready' && created && (
                <div className="st-ready" key="ready">
                  <svg className="st-ready__check" viewBox="0 0 56 56" aria-hidden>
                    <circle cx="28" cy="28" r="26" />
                    <path d="M17 29.5l7.5 7.5L40 21" />
                  </svg>
                  <div className="st-create__head">
                    <h2 id={titleId}>Seu restaurante está no ar</h2>
                    <p>
                      {created.emailOn
                        ? `Mandamos o login para ${created.email}.`
                        : 'Guarde esses dados: eles aparecem só agora.'}{' '}
                      O teste vale por {created.trialDays} dias.
                    </p>
                  </div>
                  <dl className="st-cred">
                    <div>
                      <dt>Endereço</dt>
                      <dd>{created.url.replace(/^https?:\/\//, '')}</dd>
                    </div>
                    <div>
                      <dt>Login</dt>
                      <dd>{created.email}</dd>
                    </div>
                    <div>
                      <dt>Senha</dt>
                      <dd className="st-cred__pass">{created.password}</dd>
                    </div>
                  </dl>
                  <div className="st-create__foot">
                    <Button
                      variant="secondary"
                      onClick={() => void copy()}
                      icon={<Copy size={15} />}
                    >
                      {copied ? 'Copiado' : 'Copiar login'}
                    </Button>
                    <Button size="lg" className="st-press" onClick={onEnter} loading={!reachable}>
                      {reachable ? 'Abrir meu restaurante' : 'Preparando o endereço'}
                    </Button>
                  </div>
                </div>
              )}

              {phase === 'failed' && (
                <div className="st-create__build" key="failed">
                  <div className="st-create__head">
                    <h2 id={titleId}>Não deu certo</h2>
                  </div>
                  <Alert tone="danger">
                    Não conseguimos criar o restaurante agora. Tente de novo em alguns minutos ou
                    fale com a gente.
                  </Alert>
                  <div className="st-create__foot">
                    <Button variant="ghost" onClick={() => onClose()}>
                      Fechar
                    </Button>
                    <Button onClick={onRetry}>Tentar de novo</Button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </dialog>
  );
}
