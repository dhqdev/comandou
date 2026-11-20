import { CheckCircle2, Clock, Download, Eraser, FileText, Lock, PenLine, Type } from 'lucide-react';
import { FormEvent, PointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Mascot, TextField, ThemeToggle, Skeleton } from '../design-system';
import { api, ApiError } from '../lib/api';
import { brl } from '../lib/money';
import { maskDocument } from './NewTenant';
import type { ContractContent, ContractGeo, PublicContract } from './types';
import './contract-sign.css';

/** O link de assinatura é admin.<base>/assinar/<token>. */
export const signToken = (path = window.location.pathname) =>
  /^\/assinar\/([A-Za-z0-9_-]{30,60})\/?$/.exec(path)?.[1] ?? null;

const fmtDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/**
 * Localização do aparelho para o registro da assinatura. Só com a permissão da pessoa; se ela
 * negar, demorar ou o aparelho não tiver, a assinatura segue sem (o IP fica registrado sempre).
 */
export function askGeo(timeoutMs = 8000): Promise<ContractGeo | undefined> {
  if (!('geolocation' in navigator)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const t = window.setTimeout(() => resolve(undefined), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        window.clearTimeout(t);
        resolve({
          lat: Math.round(p.coords.latitude * 1e6) / 1e6,
          lng: Math.round(p.coords.longitude * 1e6) / 1e6,
          accuracy: Math.round(p.coords.accuracy),
        });
      },
      () => {
        window.clearTimeout(t);
        resolve(undefined);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

function ContractText({ c }: { c: ContractContent }) {
  const t = c.terms;
  const summary: [string, string][] = [
    [
      'Contratante',
      `${c.parties.customer.name}${c.parties.customer.document ? ` · ${c.parties.customer.document}` : ''}`,
    ],
    ['Loja', `${t.storeName} (${t.systemAddress})`],
    ['Plano', t.planName],
    ['Mensalidade', `${brl(t.priceMonthly)}, vencimento todo dia ${t.dueDay}`],
    ['Implantação', Number(t.setupFee) > 0 ? brl(t.setupFee) : 'sem taxa'],
    [
      'Vigência',
      `${t.termMonths} ${t.termMonths === 1 ? 'mês' : 'meses'} a partir de ${fmtDate(t.startDate)}`,
    ],
    ['Contratada', c.parties.provider.name],
  ];
  return (
    <article className="cs-doc">
      <h1 className="cs-doc__title">{c.title}</h1>
      <p className="cs-doc__number">Contrato nº {c.number}</p>
      <dl className="cs-summary">
        {summary.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p>{c.preamble}</p>
      {c.clauses.map((cl, i) => {
        let p = 0;
        return (
          <section key={i} className="cs-clause">
            <h2>
              Cláusula {i + 1} · {cl.title}
            </h2>
            {cl.items.map((it, j) =>
              typeof it === 'string' ? (
                <p key={j}>
                  <b>
                    {i + 1}.{++p}.
                  </b>{' '}
                  {it}
                </p>
              ) : (
                <ol key={j} type="a">
                  {it.map((s, k) => (
                    <li key={k}>{s}</li>
                  ))}
                </ol>
              ),
            )}
          </section>
        );
      })}
      <p>{c.closing}</p>
    </article>
  );
}

/** Quadro para desenhar a assinatura com o dedo ou o mouse. */
export function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const dirty = useRef(false);

  const setup = useCallback(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#13285f';
    dirty.current = false;
    onChange(null);
  }, [onChange]);

  useEffect(() => {
    setup();
  }, [setup]);

  const pos = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (dirty.current) onChange(ref.current!.toDataURL('image/png'));
  };

  return (
    <div className="cs-pad">
      <canvas
        ref={ref}
        className="cs-pad__canvas"
        aria-label="Área para desenhar a assinatura"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = pos(e);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const ctx = e.currentTarget.getContext('2d')!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(last.current.x, last.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          last.current = p;
          dirty.current = true;
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={finish}
      />
      <span className="cs-pad__line" aria-hidden />
      <button type="button" className="cs-pad__clear" onClick={setup}>
        <Eraser size={14} /> Limpar
      </button>
    </div>
  );
}

/** Página pública: o cliente lê o contrato até o fim e assina (sem login). */
export function ContractSignPage({ token }: { token: string }) {
  const [c, setC] = useState<PublicContract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState(false);
  const [progress, setProgress] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [name, setName] = useState('');
  const [doc, setDoc] = useState('');
  const [email, setEmail] = useState('');
  const [kind, setKind] = useState<'drawn' | 'typed'>('drawn');
  const [png, setPng] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const base = `/platform/sign/${token}`;

  useEffect(() => {
    document.title = 'Assinar contrato · Comandou';
    api<PublicContract>(base)
      .then((r) => {
        setC(r);
        setEmail(r.signerEmail ?? '');
        setName(r.content.parties.customer.representative ?? '');
        if (r.readAt) setRead(true);
      })
      .catch((e: Error) => setError(e.message));
  }, [base]);

  // Barra de leitura e o fim do texto (libera a assinatura uma vez).
  useEffect(() => {
    if (!c || c.status === 'signed') return;
    const onScroll = () => {
      const el = document.documentElement;
      const target = end.current ? end.current.offsetTop - window.innerHeight : el.scrollHeight;
      setProgress(
        Math.min(100, Math.max(0, Math.round((window.scrollY / Math.max(target, 1)) * 100))),
      );
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setRead((was) => {
          if (!was) void api(`${base}/read`, { method: 'POST' }).catch(() => undefined);
          return true;
        });
      }
    });
    if (end.current) io.observe(end.current);
    return () => {
      window.removeEventListener('scroll', onScroll);
      io.disconnect();
    };
  }, [c, base]);

  const cpfOk = doc.replace(/\D/g, '').length === 11;
  const sigOk = kind === 'drawn' ? !!png : typed.trim().length >= 3;
  const ready =
    read &&
    name.trim().split(/\s+/).length >= 2 &&
    cpfOk &&
    /^\S+@\S+\.\S+$/.test(email) &&
    sigOk &&
    accept;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!c || !ready) return;
    setBusy(true);
    setSignError(null);
    try {
      const geo = await askGeo();
      const r = await api<PublicContract>(base, {
        method: 'POST',
        json: {
          name: name.trim(),
          document: doc,
          email: email.trim(),
          accept: true,
          contentHash: c.contentHash,
          signature: kind === 'drawn' ? { kind, image: png } : { kind, text: typed.trim() },
          ...(geo ? { geo } : {}),
        },
      });
      setC(r);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setSignError(
        err instanceof ApiError && err.status === 400
          ? 'Confira o nome completo, o CPF e o e-mail.'
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <header className="cs-top">
      <Mascot size={28} badge title="Comandou" />
      <span className="cs-top__title">Assinatura de contrato</span>
      <span style={{ flex: 1 }} />
      <ThemeToggle />
    </header>
  );

  if (error)
    return (
      <div className="cs-page">
        {header}
        <main className="cs-main">
          <Alert tone="danger">{error}</Alert>
        </main>
      </div>
    );
  if (!c)
    return (
      <div className="cs-page">
        {header}
        <main
          className="cs-main"
          style={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}
        >
          <Skeleton variant="detail" />
        </main>
      </div>
    );

  if (c.status === 'client_signed')
    return (
      <div className="cs-page">
        {header}
        <main className="cs-main">
          <div className="cs-done">
            <Clock size={44} className="cs-done__icon" />
            <h1>Assinatura recebida</h1>
            <p>
              {c.signerName} assinou o contrato nº {c.number}
              {c.signedAt ? ` em ${new Date(c.signedAt).toLocaleString('pt-BR')}` : ''}. Agora{' '}
              {c.content.parties.provider.name} confere e assina
              {c.countersignDeadline
                ? ` até ${new Date(c.countersignDeadline).toLocaleDateString('pt-BR')}`
                : ''}
              . A via final, com as duas assinaturas, chega no seu e-mail.
            </p>
            <a className="cm-btn cm-btn--secondary cm-btn--lg" href={`/api/v1${base}/pdf`}>
              <FileText size={18} /> Baixar o contrato
            </a>
            <p className="cs-hash">Código de integridade do texto: {c.contentHash}</p>
          </div>
        </main>
      </div>
    );

  if (c.status === 'signed')
    return (
      <div className="cs-page">
        {header}
        <main className="cs-main">
          <div className="cs-done">
            <CheckCircle2 size={44} className="cs-done__icon" />
            <h1>Contrato assinado</h1>
            <p>
              {c.countersignedAt
                ? `O contrato nº ${c.number} está assinado por ${c.signerName} e por ${c.content.parties.provider.name} (concluído em ${new Date(c.countersignedAt).toLocaleString('pt-BR')}).`
                : `${c.signerName} assinou o contrato nº ${c.number}${c.signedAt ? ` em ${new Date(c.signedAt).toLocaleString('pt-BR')}` : ''}.`}{' '}
              Uma via foi enviada para o seu e-mail.
            </p>
            <a className="cm-btn cm-btn--primary cm-btn--lg" href={`/api/v1${base}/pdf?signed=1`}>
              <Download size={18} /> Baixar contrato assinado
            </a>
            <p className="cs-hash">Código de integridade do texto: {c.contentHash}</p>
          </div>
        </main>
      </div>
    );

  if (c.status === 'cancelled')
    return (
      <div className="cs-page">
        {header}
        <main className="cs-main">
          <Alert tone="warning">Este contrato foi cancelado por quem enviou.</Alert>
        </main>
      </div>
    );

  return (
    <div className="cs-page">
      {header}
      <div className="cs-progress" aria-hidden>
        <i style={{ width: `${read ? 100 : progress}%` }} />
      </div>
      <main className="cs-main">
        <div className="cs-intro">
          <p>
            <b>{c.content.parties.provider.name}</b> enviou este contrato para{' '}
            <b>{c.content.parties.customer.name}</b> assinar. Leia com calma até o fim: a assinatura
            é liberada depois.
          </p>
          <a className="cs-link" href={`/api/v1${base}/pdf`}>
            <FileText size={15} /> Baixar em PDF
          </a>
        </div>

        <ContractText c={c.content} />
        <div ref={end} className="cs-end" />

        <form ref={form} className="cs-sign" onSubmit={submit} noValidate>
          <h2>Assinar</h2>
          {!read && (
            <div className="cs-locked">
              <Lock size={16} /> Role o contrato até o fim para liberar a assinatura.
            </div>
          )}
          <fieldset disabled={!read} className="cs-sign__fields">
            <TextField
              label="Nome completo"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField
              label="CPF"
              inputMode="numeric"
              value={doc}
              onChange={(e) => setDoc(maskDocument(e.target.value).slice(0, 14))}
            />
            <TextField
              label="E-mail"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              hint="A via assinada vai para este e-mail."
            />
            <div className="cs-kind" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={kind === 'drawn'}
                onClick={() => setKind('drawn')}
              >
                <PenLine size={15} /> Desenhar
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={kind === 'typed'}
                onClick={() => setKind('typed')}
              >
                <Type size={15} /> Digitar
              </button>
            </div>
            {kind === 'drawn' ? (
              <SignaturePad onChange={setPng} />
            ) : (
              <div className="cs-typed">
                <TextField
                  label="Digite o seu nome como assinatura"
                  value={typed}
                  maxLength={80}
                  onChange={(e) => setTyped(e.target.value)}
                />
                <div className="cs-typed__preview" aria-hidden>
                  {typed || ' '}
                </div>
              </div>
            )}
            <label className="cs-accept">
              <input
                type="checkbox"
                checked={accept}
                onChange={(e) => setAccept(e.target.checked)}
              />
              <span>
                Li todo o contrato, concordo com as suas cláusulas e declaro ter poderes para
                assinar em nome de {c.content.parties.customer.name}.
              </span>
            </label>
          </fieldset>
          {signError && <Alert tone="danger">{signError}</Alert>}
          <Button type="submit" size="lg" block loading={busy} disabled={!ready}>
            Assinar contrato
          </Button>
          <p className="cs-legal">
            Assinatura eletrônica (MP 2.200-2/2001, art. 10, § 2º, e Lei 14.063/2020). Ficam
            registrados nome, CPF, e-mail, data e hora, IP, navegador e o código de integridade do
            documento. Se você permitir, a localização do aparelho também. Você assina primeiro;
            depois {c.content.parties.provider.name} assina e a via final chega no seu e-mail.
          </p>
        </form>
      </main>
    </div>
  );
}
