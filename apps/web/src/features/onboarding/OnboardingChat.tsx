import { ArrowUp, Check } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button, Mascot } from '../../design-system';
import { api } from '../../lib/api';
import type { StoreSettings } from '../../lib/types';
import { maskPhone } from '../CustomerPicker';
import { importStatus } from '../menu-import/menu-import';
import { QuickStart } from './QuickStart';
import { loadSignup, trialAuto, type ApplyResult, type Signup } from './quick-start';
import './onboarding.css';

/**
 * Primeiros passos em forma de conversa: o mascote pergunta, a pessoa responde tocando ou
 * digitando, e cada resposta já grava no cadastro da loja (os mesmos campos de Ajustes e Loja
 * online). Começa pelo cardápio: o link ou as fotos, lidos pela IA, montam itens, fotos, logo,
 * cores, ícone, contato, endereço, ponto no mapa e horário de uma vez. Os dados do cadastro
 * (telefone, cidade) entram sozinhos. Depois só pergunta o que faltou. Abre sozinho no primeiro
 * acesso de quem administra uma loja ainda sem itens; dá para rever em Conta.
 */

const key = (tenantId: string, userId: string) => `cm-tour:inicio:${tenantId}:${userId}`;

export function onboardingSeen(tenantId: string, userId: string) {
  try {
    return localStorage.getItem(key(tenantId, userId)) === 'done';
  } catch {
    return true;
  }
}
export function markOnboardingSeen(tenantId: string, userId: string) {
  try {
    localStorage.setItem(key(tenantId, userId), 'done');
  } catch {
    /* sem armazenamento */
  }
}

type Step = 'hello' | 'sell' | 'whats' | 'address' | 'eta' | 'menu' | 'end';
const ORDER: Step[] = ['hello', 'menu', 'sell', 'whats', 'address', 'eta', 'end'];
interface Msg {
  id: number;
  from: 'bot' | 'me';
  text: string;
}

const SELL = [
  { key: 'delivery', label: 'Entrega' },
  { key: 'pickup', label: 'Retirada no balcão' },
  { key: 'tables', label: 'Mesas no salão' },
] as const;
type SellKey = (typeof SELL)[number]['key'];

const ETAS: [number, number][] = [
  [15, 30],
  [30, 45],
  [45, 60],
  [60, 90],
];

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function OnboardingChat({
  open,
  onClose,
  onTour,
  userName,
  tenantName,
  canImport,
}: {
  open: boolean;
  onClose: () => void;
  /** "Conhecer as telas": fecha a conversa e abre a apresentação guiada. */
  onTour: () => void;
  userName: string;
  tenantName: string;
  /** Pode cadastrar itens (catalog:write): sem isso a conversa pula o cardápio. */
  canImport: boolean;
}) {
  const navigate = useNavigate();
  const [log, setLog] = useState<Msg[]>([]);
  const [step, setStep] = useState<Step>('hello');
  const [typing, setTyping] = useState(false);
  const [sell, setSell] = useState<Set<SellKey>>(new Set());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [signup, setSignup] = useState<Signup | null>(null);
  /** Leitura por IA (foto, link) disponível: sem ela, a pessoa escreve os itens. */
  const aiOn = useRef(true);
  /** O que a loja já tem (do cadastro ou do cardápio): a conversa não pergunta de novo. */
  const known = useRef({ whatsapp: false, address: false });
  /** Acompanha o fim da conversa; na conferência do cardápio a pessoa rola sozinha. */
  const follow = useRef(true);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const first = userName.split(' ')[0] ?? userName;

  const push = useCallback((from: Msg['from'], t: string) => {
    setLog((cur) => [...cur, { id: ++seq.current, from, text: t }]);
  }, []);

  /** O mascote "digita" e fala as frases em sequência; depois libera a resposta do passo. */
  const say = useCallback(
    (lines: string[], next: Step) => {
      const gap = reduced() ? 0 : 520;
      setTyping(true);
      lines.forEach((line, i) => {
        timers.current.push(
          window.setTimeout(
            () => {
              push('bot', line);
              if (i === lines.length - 1) {
                setTyping(false);
                setStep(next);
              }
            },
            gap * (i + 1),
          ),
        );
      });
    },
    [push],
  );

  useEffect(() => {
    if (!open) return;
    setLog([]);
    setSell(new Set());
    setText('');
    seq.current = 0;
    known.current = { whatsapp: false, address: false };
    if (canImport)
      void importStatus().then(
        (s) => (aiOn.current = s.enabled),
        () => (aiOn.current = false),
      );
    // Dados do cadastro (feito na contratação) entram sozinhos onde a loja ainda está vazia.
    void Promise.all([loadSignup(), api<StoreSettings>('/store/settings').catch(() => null)]).then(
      async ([sg, st]) => {
        setSignup(sg);
        if (!st) return;
        const patch: Partial<StoreSettings> = {};
        if (!st.whatsapp && sg?.phone) patch.whatsapp = maskPhone(sg.phone);
        if (!st.city && sg?.city) patch.city = sg.city;
        if (!st.state && sg?.state) patch.state = sg.state;
        if (Object.keys(patch).length)
          await api('/store/settings', { method: 'PATCH', json: patch }).catch(() => undefined);
        known.current = {
          whatsapp: !!(st.whatsapp || patch.whatsapp),
          address: !!st.address,
        };
      },
    );
    say(
      [
        `Oi, ${first}! Eu sou o Comandou.`,
        `Vou deixar ${tenantName} pronto para vender. São só algumas perguntas rápidas.`,
      ],
      'hello',
    );
    const pending = timers.current;
    return () => {
      pending.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, [open, first, tenantName, say, canImport]);

  // Acompanha o fim da conversa, inclusive quando o cartão do cardápio cresce.
  useEffect(() => {
    const thread = end.current?.parentElement;
    if (!open || !thread) return;
    const toEnd = () =>
      follow.current &&
      end.current?.scrollIntoView({ block: 'end', behavior: reduced() ? 'auto' : 'smooth' });
    const ro = new ResizeObserver(toEnd);
    ro.observe(thread);
    return () => ro.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /** Grava a resposta no cadastro da loja. Se falhar, a conversa segue e avisa onde ajustar. */
  const savePatch = async (patch: Partial<StoreSettings>) => {
    setBusy(true);
    try {
      await api('/store/settings', { method: 'PATCH', json: patch });
      return true;
    } catch {
      push('bot', 'Não consegui salvar essa resposta agora. Depois você ajusta em Ajustes.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const askMenu = () => {
    if (!canImport) return askSell();
    // Teste criado pelo site: o que foi montado ou escrito lá já vem para a conferência.
    const auto = trialAuto(signup, aiOn.current);
    say(
      auto === 'site'
        ? [
            'A loja que a IA montou no comandou.com já veio para cá.',
            'Confira os itens e os preços, corrija o que precisar e aplique. Depois dá para mudar tudo em Cardápio.',
          ]
        : auto === 'text'
          ? [
              'Trouxe os itens que você escreveu no site.',
              'Confira os nomes e os preços, corrija o que precisar e aplique.',
            ]
          : aiOn.current
            ? [
                'Para começar, me mande o seu cardápio: o link ou fotos dele.',
                'Eu leio os itens, os preços e as fotos, e pego o logo, as cores, o contato, o endereço e o horário. Você só confere e aplica.',
              ]
            : [
                'Para começar, escreva os itens do seu cardápio: um por linha, com o preço.',
                'Fotos, logo e cores você coloca depois em Cardápio e Loja online.',
              ],
      'menu',
    );
  };
  const askSell = (lead?: string[]) =>
    say([...(lead ?? []), 'Como você vende? Pode marcar mais de um.'], 'sell');
  const finish = (lead?: string) =>
    say(
      [
        ...(lead ? [lead] : []),
        'Pronto! O básico está feito. O resto você ajusta quando quiser em Ajustes.',
      ],
      'end',
    );
  const askEta = () =>
    sell.has('delivery') || sell.has('pickup')
      ? say(['Quanto tempo leva, em média, para um pedido ficar pronto?'], 'eta')
      : finish();
  const askAddress = () =>
    known.current.address
      ? askEta()
      : say(['E o endereço da loja? Rua, número e bairro.'], 'address');
  const askWhats = () =>
    known.current.whatsapp
      ? askAddress()
      : say(['Qual é o WhatsApp da loja? Ele aparece para o cliente no cardápio.'], 'whats');

  const menuDone = (r: ApplyResult) => {
    known.current = {
      whatsapp: known.current.whatsapp || r.saved.whatsapp,
      address: known.current.address || r.saved.address,
    };
    const got = [
      r.created && (r.created === 1 ? '1 item' : `${r.created} itens`),
      r.saved.identity && 'logo e cores',
      r.saved.address && 'endereço',
      r.saved.location && 'ponto no mapa',
    ].filter(Boolean) as string[];
    push('me', got.length ? `Aplicado: ${got.join(', ')}` : 'Cardápio conferido');
    const lead = [
      r.created
        ? r.saved.identity
          ? 'Ficou ótimo. Seu cardápio já está no ar no PDV e na loja online, com a cara da sua marca.'
          : 'Ficou ótimo. Seu cardápio já está no ar no PDV e na loja online.'
        : 'Pronto, a loja já está com os dados que encontrei.',
      ...r.warnings,
      ...(r.stopped ? [`Parei antes do fim dos itens: ${r.stopped}`] : []),
      ...(r.failed.length
        ? [
            `${r.failed.length === 1 ? '1 item não entrou' : `${r.failed.length} itens não entraram`}. Você cadastra em Cardápio › Itens.`,
          ]
        : []),
    ];
    askSell(lead);
  };

  const answerSell = async () => {
    push(
      'me',
      SELL.filter((s) => sell.has(s.key))
        .map((s) => s.label)
        .join(', '),
    );
    await savePatch({ acceptsDelivery: sell.has('delivery'), acceptsPickup: sell.has('pickup') });
    askWhats();
  };
  const answerWhats = async (skip?: boolean) => {
    const v = text.trim();
    setText('');
    push('me', skip || !v ? 'Depois eu coloco' : v);
    if (!skip && v) await savePatch({ whatsapp: v });
    askAddress();
  };
  const answerAddress = async (skip?: boolean) => {
    const v = text.trim();
    setText('');
    push('me', skip || !v ? 'Depois eu coloco' : v);
    if (!skip && v) await savePatch({ address: v });
    askEta();
  };
  const answerEta = async ([min, max]: [number, number]) => {
    push('me', `${min} a ${max} minutos`);
    await savePatch({ etaMin: min, etaMax: max });
    finish();
  };

  if (!open) return null;

  const at = typing ? null : step;
  const input = (placeholder: string, send: (skip?: boolean) => void, tel?: boolean) => (
    <form
      className="onb-input"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <input
        autoFocus
        type={tel ? 'tel' : 'text'}
        inputMode={tel ? 'tel' : undefined}
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        maxLength={tel ? 20 : 300}
        onChange={(e) => setText(tel ? maskPhone(e.target.value) : e.target.value)}
      />
      <button type="button" className="onb-skip" onClick={() => send(true)} disabled={busy}>
        Depois
      </button>
      <button
        type="submit"
        className="onb-send"
        aria-label="Enviar"
        disabled={busy || !text.trim()}
      >
        <ArrowUp size={16} aria-hidden />
      </button>
    </form>
  );

  let reply: ReactNode = null;
  if (at === 'hello')
    reply = (
      <div className="onb-choices">
        <Button
          onClick={() => {
            push('me', 'Vamos lá');
            askMenu();
          }}
        >
          Vamos lá
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Agora não
        </Button>
      </div>
    );
  else if (at === 'sell')
    reply = (
      <div className="onb-choices">
        {SELL.map((s) => (
          <button
            key={s.key}
            type="button"
            className="onb-chip"
            aria-pressed={sell.has(s.key)}
            onClick={() =>
              setSell((cur) => {
                const n = new Set(cur);
                if (!n.delete(s.key)) n.add(s.key);
                return n;
              })
            }
          >
            {sell.has(s.key) && <Check size={14} aria-hidden />}
            {s.label}
          </button>
        ))}
        <Button disabled={sell.size === 0 || busy} onClick={answerSell}>
          Continuar
        </Button>
      </div>
    );
  else if (at === 'whats') reply = input('(11) 99999-9999', answerWhats, true);
  else if (at === 'address') reply = input('Rua, número e bairro', answerAddress);
  else if (at === 'eta')
    reply = (
      <div className="onb-choices">
        {ETAS.map((e) => (
          <button
            key={e[0]}
            type="button"
            className="onb-chip"
            disabled={busy}
            onClick={() => answerEta(e)}
          >
            {e[0]} a {e[1]} min
          </button>
        ))}
      </div>
    );
  else if (at === 'end')
    reply = (
      <div className="onb-choices">
        <Button onClick={onTour}>Conhecer as telas</Button>
        {canImport && (
          <Button
            variant="secondary"
            onClick={() => {
              onClose();
              navigate('/cardapio');
            }}
          >
            Abrir o cardápio
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          Concluir
        </Button>
      </div>
    );

  const progress = Math.round((ORDER.indexOf(step) / (ORDER.length - 1)) * 100);

  return (
    <div
      className="onb"
      data-wide={at === 'menu' || undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Primeiros passos"
    >
      <header className="onb-head">
        <Mascot size={28} badge />
        <div className="onb-head__text">
          <strong>Comandou</strong>
          <span>Primeiros passos</span>
        </div>
        <button type="button" className="onb-skip" onClick={onClose}>
          Pular
        </button>
        <div className="onb-progress" aria-hidden>
          <i style={{ width: `${progress}%` }} />
        </div>
      </header>
      <div className="onb-scroll">
        <div className="onb-thread" aria-live="polite">
          {log.map((m, i) => (
            <div key={m.id} className={`onb-msg onb-msg--${m.from}`}>
              {m.from === 'bot' &&
                (log[i - 1]?.from === 'bot' ? (
                  <span className="onb-msg__gap" />
                ) : (
                  <Mascot size={28} badge className="onb-msg__avatar" />
                ))}
              <p>{m.text}</p>
            </div>
          ))}
          {at === 'menu' && (
            <div className="onb-card onb-card--menu">
              <QuickStart
                signup={signup}
                onReview={(on) => (follow.current = !on)}
                onDone={(r) => {
                  follow.current = true;
                  menuDone(r);
                }}
                onSkip={() => {
                  follow.current = true;
                  push('me', 'Ainda não tenho cardápio pronto');
                  askSell([
                    aiOn.current
                      ? 'Sem problema. Quando quiser, é só abrir Cardápio › Itens › Importar com IA.'
                      : 'Sem problema. Quando quiser, é só abrir Cardápio › Itens.',
                  ]);
                }}
              />
            </div>
          )}
          {typing && (
            <div className="onb-msg onb-msg--bot" aria-label="Comandou está digitando">
              {log[log.length - 1]?.from === 'bot' ? (
                <span className="onb-msg__gap" />
              ) : (
                <Mascot size={28} badge className="onb-msg__avatar" />
              )}
              <p className="onb-typing">
                <i />
                <i />
                <i />
              </p>
            </div>
          )}
          <div ref={end} />
        </div>
      </div>
      {at !== 'menu' && <footer className="onb-reply">{reply}</footer>}
    </div>
  );
}
