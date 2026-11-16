import { ArrowLeft, ArrowUp, Check, Clock, FileText, Globe } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button, Mascot } from '../../design-system';
import { api } from '../../lib/api';
import type { StoreSettings } from '../../lib/types';
import { maskPhone } from '../CustomerPicker';
import { importStatus } from '../menu-import/menu-import';
import { createSitePage, openSitePage } from '../SitePageCard';
import { QuickStart } from './QuickStart';
import { loadSignup, trialAuto, type ApplyResult, type Signup } from './quick-start';
import './onboarding.css';

/**
 * Primeiros passos em forma de conversa: o mascote pergunta, a pessoa responde tocando ou
 * digitando, e cada resposta já grava no cadastro da loja (os mesmos campos de Ajustes e Loja
 * online). Começa perguntando se o cardápio já está pronto: se estiver, a pessoa joga as fotos,
 * o PDF ou o link e a IA monta itens, fotos, logo, cores, ícone, contato, endereço, ponto no
 * mapa e horário de uma vez, para conferir na tela seguinte. Os dados do cadastro (telefone,
 * cidade) entram sozinhos. Depois só pergunta o que faltou. O "Voltar" refaz o passo anterior
 * com as respostas guardadas. Abre sozinho no primeiro acesso de quem administra uma loja ainda
 * sem itens; dá para rever em Conta.
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

type Step = 'hello' | 'has-menu' | 'menu' | 'sell' | 'whats' | 'address' | 'eta' | 'end';
const ORDER: Step[] = ['hello', 'has-menu', 'menu', 'sell', 'whats', 'address', 'eta', 'end'];
/** Passo já mostrado e onde a conversa estava quando a pergunta dele terminou (para voltar). */
interface Mark {
  step: Step;
  end: number;
}
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
  const [aiOn, setAiOn] = useState(true);
  /** Caminho percorrido: o "Voltar" desfaz um passo por vez. */
  const [trail, setTrail] = useState<Mark[]>([]);
  /** O cartão do cardápio já abriu: fica guardado (escondido) quando a pessoa volta ou segue. */
  const [menuOpened, setMenuOpened] = useState(false);
  const [menuBusy, setMenuBusy] = useState(false);
  /** A página do restaurante (/site) foi criada no fim da conversa. */
  const [siteReady, setSiteReady] = useState(false);
  /** Respostas já dadas: voltar a um passo mostra o que a pessoa tinha respondido. */
  const answers = useRef<{
    hasMenu: boolean | null;
    whats: string;
    address: string;
    eta: number | null;
  }>({ hasMenu: null, whats: '', address: '', eta: null });
  /** "Voltar" de dentro do cartão do cardápio (conferência → envio → pergunta anterior). */
  const menuBack = useRef<(() => void) | null>(null);
  const logLen = useRef(0);
  /** O que a loja já tem (do cadastro ou do cardápio): a conversa não pergunta de novo. */
  const known = useRef({ whatsapp: false, address: false });
  /** Acompanha o fim da conversa; na conferência do cardápio a pessoa rola sozinha. */
  const follow = useRef(true);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const first = userName.split(' ')[0] ?? userName;

  const push = useCallback((from: Msg['from'], t: string) => {
    logLen.current++;
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
                const end = logLen.current;
                setTyping(false);
                setStep(next);
                setTrail((t) => [...t, { step: next, end }]);
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
    setTrail([]);
    setStep('hello');
    setMenuOpened(false);
    setMenuBusy(false);
    setSiteReady(false);
    seq.current = 0;
    logLen.current = 0;
    follow.current = true;
    answers.current = { hasMenu: null, whats: '', address: '', eta: null };
    known.current = { whatsapp: false, address: false };
    if (canImport)
      void importStatus().then(
        (s) => setAiOn(s.enabled),
        () => setAiOn(false),
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

  // Cada passo abre com o que a pessoa já tinha respondido nele.
  useEffect(() => {
    setText(
      step === 'whats' ? answers.current.whats : step === 'address' ? answers.current.address : '',
    );
    if (step === 'menu') setMenuOpened(true);
  }, [step]);

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
    const auto = trialAuto(signup, aiOn);
    if (auto === 'site')
      return say(
        [
          'A loja que a IA montou no comandou.com já veio para cá.',
          'Confira os itens e os preços, corrija o que precisar e aplique. Depois dá para mudar tudo em Cardápio.',
        ],
        'menu',
      );
    if (auto === 'text')
      return say(
        [
          'Trouxe os itens que você escreveu no site.',
          'Confira os nomes e os preços, corrija o que precisar e aplique.',
        ],
        'menu',
      );
    if (auto === 'link')
      return say(
        [
          'Estou lendo o cardápio do link que você informou no site.',
          'Quando terminar, confira os itens e os preços, corrija o que precisar e aplique.',
        ],
        'menu',
      );
    say(
      [
        'Vamos começar pelo cardápio.',
        'Você já tem um cardápio pronto? Pode ser impresso, em PDF, numa foto ou num site.',
      ],
      'has-menu',
    );
  };
  const answerHasMenu = (yes: boolean) => {
    answers.current.hasMenu = yes;
    if (!yes) {
      push('me', 'Ainda não tenho');
      return askSell([
        aiOn
          ? 'Sem problema. Quando tiver, é só abrir Cardápio › Itens › Importar com IA.'
          : 'Sem problema. Quando tiver, é só abrir Cardápio › Itens.',
      ]);
    }
    push('me', 'Sim, já tenho');
    say(
      aiOn
        ? [
            'Ótimo! Jogue o cardápio aqui embaixo: as fotos, o PDF ou o link.',
            'Eu leio tudo de uma vez e na próxima tela você confere antes de aplicar.',
          ]
        : [
            'Ótimo! Escreva ou cole os itens aqui embaixo: um por linha, com o preço.',
            'Fotos, logo e cores você coloca depois em Cardápio e Loja online.',
          ],
      'menu',
    );
  };

  const onReview = useCallback((on: boolean) => void (follow.current = !on), []);

  /** Volta um passo: a conversa volta ao ponto da pergunta e as respostas continuam guardadas. */
  const backStep = () => {
    if (trail.length < 2) return;
    const rest = trail.slice(0, -1);
    const prev = rest[rest.length - 1]!;
    follow.current = true;
    logLen.current = prev.end;
    setTrail(rest);
    setLog((cur) => cur.slice(0, prev.end));
    setStep(prev.step);
  };
  const askSell = (lead?: string[]) =>
    say([...(lead ?? []), 'Como você vende? Pode marcar mais de um.'], 'sell');
  /**
   * Fim: a IA cria a página do restaurante (<endereço>/site) com o que foi cadastrado e a
   * conversa mostra o endereço. Sem permissão ou com erro, termina sem a página (dá para criar
   * depois em Loja online › Página).
   */
  const finish = async (lead?: string) => {
    let site: string[] = [];
    if (canImport) {
      setTyping(true);
      const ok = await createSitePage().then(
        () => true,
        () => false,
      );
      setSiteReady(ok);
      if (ok)
        site = [
          `Também criei a página do ${tenantName}: ${window.location.host}/site. Ela mostra o logo, alguns itens, o endereço e o botão para pedir.`,
          'Você abre pelo PDV (botão do globo) e muda os textos em Loja online › Página.',
        ];
    }
    say(
      [
        ...(lead ? [lead] : []),
        ...site,
        'Pronto! O básico está feito. O resto você ajusta quando quiser em Ajustes.',
      ],
      'end',
    );
  };
  const askEta = () =>
    sell.has('delivery') || sell.has('pickup')
      ? say(['Quanto tempo leva, em média, para um pedido ficar pronto?'], 'eta')
      : void finish();
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
    answers.current.whats = skip ? '' : v;
    setText('');
    push('me', skip || !v ? 'Depois eu coloco' : v);
    if (!skip && v) await savePatch({ whatsapp: v });
    askAddress();
  };
  const answerAddress = async (skip?: boolean) => {
    const v = text.trim();
    answers.current.address = skip ? '' : v;
    setText('');
    push('me', skip || !v ? 'Depois eu coloco' : v);
    if (!skip && v) await savePatch({ address: v });
    askEta();
  };
  const answerEta = async ([min, max]: [number, number]) => {
    answers.current.eta = min;
    push('me', `${min} a ${max} minutos`);
    await savePatch({ etaMin: min, etaMax: max });
    void finish();
  };

  if (!open) return null;

  const at = typing ? null : step;
  const canBack = trail.length > 1 && !typing && !busy && !menuBusy;
  const goBack = () => {
    if (!canBack) return;
    if (step === 'menu' && menuBack.current) menuBack.current();
    else backStep();
  };
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
  else if (at === 'has-menu')
    reply = (
      <div className="onb-options">
        <button
          type="button"
          className="onb-option"
          aria-pressed={answers.current.hasMenu === true}
          onClick={() => answerHasMenu(true)}
        >
          <FileText size={22} aria-hidden />
          <span className="onb-option__title">Sim, já tenho</span>
          <span className="onb-option__hint">
            {aiOn
              ? 'Mando as fotos, o PDF ou o link e a IA monta tudo'
              : 'Escrevo ou colo os itens com os preços'}
          </span>
        </button>
        <button
          type="button"
          className="onb-option"
          aria-pressed={answers.current.hasMenu === false}
          onClick={() => answerHasMenu(false)}
        >
          <Clock size={22} aria-hidden />
          <span className="onb-option__title">Ainda não tenho</span>
          <span className="onb-option__hint">Monto o cardápio depois, com calma</span>
        </button>
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
            aria-pressed={answers.current.eta === e[0]}
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
        {siteReady && (
          <Button variant="secondary" icon={<Globe size={16} />} onClick={openSitePage}>
            Ver a página
          </Button>
        )}
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
        <button
          type="button"
          className="onb-back"
          aria-label="Voltar ao passo anterior"
          disabled={!canBack}
          hidden={trail.length < 2}
          onClick={goBack}
        >
          <ArrowLeft size={16} aria-hidden />
          Voltar
        </button>
        <Mascot size={36} badge />
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
                  <Mascot size={36} badge className="onb-msg__avatar" />
                ))}
              <p>{m.text}</p>
            </div>
          ))}
          {menuOpened && (
            <div className="onb-card onb-card--menu" hidden={at !== 'menu'}>
              <QuickStart
                signup={signup}
                active={at === 'menu'}
                backRef={menuBack}
                onBusy={setMenuBusy}
                onBack={backStep}
                onReview={onReview}
                onDone={(r) => {
                  follow.current = true;
                  menuDone(r);
                }}
              />
            </div>
          )}
          {typing && (
            <div className="onb-msg onb-msg--bot" aria-label="Comandou está digitando">
              {log[log.length - 1]?.from === 'bot' ? (
                <span className="onb-msg__gap" />
              ) : (
                <Mascot size={36} badge className="onb-msg__avatar" />
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
