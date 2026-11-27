import {
  AtSign,
  Bell,
  CheckCheck,
  Megaphone,
  MessageSquarePlus,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Square,
  Users,
} from 'lucide-react';
import {
  KeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router';
import { useCan } from '../../app/auth';
import { LivePanda, PandaMood, useToast } from '../../design-system';
import { ApiError } from '../../lib/api';
import { useRealtimeEvents } from '../../lib/realtime';
import { AiMessage, AiStatus, AiUsage, askAi, chatApi, Notice } from './chat-api';
import { Markdown } from './markdown';
import { Avatar, fmtInt, keepFocus, shortWhen } from './util';

export { MuralTab } from './Mural';

// ------------------------------------------------------------------ Avisos

const NOTICE_ICON = {
  mention: <AtSign size={16} />,
  group: <Users size={16} />,
  post: <Megaphone size={16} />,
  ai: <Sparkles size={16} />,
  system: <Bell size={16} />,
};

export function NoticesTab({
  onOpenConversation,
  onOpenMural,
  onChanged,
}: {
  onOpenConversation: (id: string) => void;
  onOpenMural: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Notice[] | null>(null);
  const load = useCallback(() => chatApi.notices().then(setItems, () => setItems([])), []);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtimeEvents((e) => {
    if (e.type === 'chat.notice') void load();
  }, false);
  // A lista só tem avisos ainda não abertos: ao clicar, o aviso sai na hora (antes da resposta
  // do servidor) e a tela já abre o que ele aponta. Avisos com mais de 7 dias somem sozinhos.
  const unread = items?.length ?? 0;
  const clearAll = async () => {
    setItems([]);
    await chatApi.readNotices().catch(() => undefined);
    onChanged();
  };
  const open = (n: Notice) => {
    setItems((list) => list?.filter((x) => x.id !== n.id) ?? list);
    void chatApi
      .readNotices([n.id])
      .catch(() => undefined)
      .then(onChanged);
    if (n.conversationId) onOpenConversation(n.conversationId);
    else if (n.postId) onOpenMural();
  };
  return (
    <div className="tc-page">
      <header className="tc-page__head">
        <Bell size={18} />
        <div>
          <strong>Avisos</strong>
          <small>{unread ? `${unread} ${unread === 1 ? 'novo' : 'novos'}` : 'Tudo em dia'}</small>
        </div>
        <span className="tc-spacer" />
        {unread > 0 && (
          <button className="tc-link" onClick={clearAll}>
            <CheckCheck size={15} /> Limpar todos
          </button>
        )}
      </header>
      <div className="tc-page__scroll">
        {items?.length === 0 && (
          <div className="tc-page__empty">
            <LivePanda size={72} mood="happy" />
            <p>Nenhum aviso por aqui.</p>
            <small>
              Menções, grupos novos e recados do mural aparecem aqui. Ao abrir, o aviso sai da
              lista; os que ficarem somem sozinhos em 7 dias.
            </small>
          </div>
        )}
        {items?.map((n) => (
          <button key={n.id} className="tc-notice is-new" onClick={() => open(n)}>
            <span className={`tc-notice__icon tc-notice__icon--${n.kind}`}>
              {NOTICE_ICON[n.kind]}
            </span>
            <span className="tc-notice__main">
              <strong>{n.title}</strong>
              {n.body && <span>{n.body}</span>}
              <time>{shortWhen(n.createdAt)}</time>
            </span>
            <i className="tc-notice__dot" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Assistente (IA)

const SUGGESTIONS: Record<string, string[]> = {
  default: [
    'Tem algo travando a loja agora?',
    'Como abro e fecho o caixa?',
    'Como cadastro um produto com foto?',
    'Como conecto a impressora da cozinha?',
    'Como emito a nota fiscal (NFC-e)?',
  ],
  '/caixa': [
    'Como faço uma sangria?',
    'Como fecho o caixa do dia?',
    'O caixa não bate, o que conferir?',
  ],
  '/cardapio': [
    'Como crio um grupo de complementos?',
    'Como deixo um item esgotado?',
    'Como monto a ficha técnica?',
  ],
  '/estoque': [
    'Como lanço a nota do fornecedor?',
    'Como faço o inventário?',
    'O que é fator de conversão?',
  ],
  '/fiscal': [
    'O que preciso para emitir NFC-e?',
    'Como envio o certificado A1?',
    'Nota rejeitada: o que fazer?',
  ],
  '/impressao': [
    'Como instalo o agente de impressão?',
    'Como separo cozinha e bar?',
    'A impressora não imprime',
  ],
  '/entregas': [
    'Como desenho as áreas de entrega?',
    'Como o entregador conclui a entrega?',
    'Como pago os entregadores?',
  ],
  '/mesas': [
    'Não consigo fechar a comanda',
    'Como transfiro itens de mesa?',
    'Como divido a conta?',
    'Como edito o desenho do salão?',
  ],
  '/pedidos': [
    'Como cancelo um pedido?',
    'O que significa cada status?',
    'Como imprimo um pedido de novo?',
  ],
  '/loja-online': [
    'Como divulgo o cardápio online?',
    'Como ligo a fidelidade?',
    'Como mudo as cores da loja?',
  ],
};

function suggestionsFor(path: string) {
  const key = Object.keys(SUGGESTIONS).find((k) => k !== 'default' && path.startsWith(k));
  return SUGGESTIONS[key ?? 'default']!;
}

const REASON: Record<string, string> = {
  platform:
    'O assistente ainda não foi ligado. Assim que o suporte do Comandou ligar, ele aparece aqui.',
  tenant: 'O assistente está desligado para este restaurante. Fale com o suporte do Comandou.',
  limit:
    'O limite de uso do assistente neste mês acabou. Ele volta no próximo mês, ou fale com o suporte do Comandou para aumentar.',
};

export function UsageBar({
  used,
  limit,
  percent,
  bonus = 0,
  compact,
  more,
}: {
  used: number;
  limit: number;
  percent: number | null;
  bonus?: number;
  compact?: boolean;
  /** Link para o painel Conta › Uso de IA (só para quem vê a assinatura). */
  more?: ReactNode;
}) {
  if (!limit)
    return compact ? null : (
      <div className="tc-usage">
        <small>
          Uso do mês: {fmtInt(used)} tokens · sem limite{more && <> · {more}</>}
        </small>
      </div>
    );
  const p = Math.min(100, percent ?? 0);
  const level = p >= 100 ? 'bad' : p >= 80 ? 'warn' : 'ok';
  return (
    <div
      className={`tc-usage tc-usage--${level}`}
      title={`${fmtInt(used)} de ${fmtInt(limit)} tokens`}
    >
      <div className="tc-usage__bar">
        <i style={{ width: `${Math.max(p, 2)}%` }} />
      </div>
      {!compact && (
        <small>
          Uso do mês: <b>{p.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</b> ·{' '}
          {fmtInt(used)} de {fmtInt(limit)} tokens
          {bonus > 0 && <> · +{fmtInt(bonus)} extras</>}
          {more && <> · {more}</>}
        </small>
      )}
    </div>
  );
}

/** Acabou o limite do mês e os tokens extras. */
function aiBlocked(u: AiUsage) {
  if (u.available !== undefined) return u.available !== null && u.available <= 0;
  return !!u.limit && u.used >= u.limit;
}

export function AiTab({ screen, onNavigate }: { screen: string; onNavigate?: () => void }) {
  const toast = useToast();
  const canPlan = useCan('plan:read');
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [msgs, setMsgs] = useState<AiMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState<PandaMood>('idle');
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const s = await chatApi.ai();
      setStatus(s);
      setMsgs(s.messages);
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }, [toast]);
  useEffect(() => {
    void load();
    return () => abort.current?.abort();
  }, [load]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const ask = async (q: string) => {
    const content = q.trim();
    if (!content || busy || !status?.enabled) return;
    setText('');
    setBusy(true);
    setMood('thinking');
    const now = new Date().toISOString();
    const tmpId = `ai-${Date.now()}`;
    setMsgs((m) => [
      ...m,
      { id: `u-${tmpId}`, role: 'user', content, createdAt: now },
      { id: tmpId, role: 'assistant', content: '', createdAt: now, streaming: true },
    ]);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const done = await askAi(
        content,
        screen,
        (d) => {
          setMood('talking');
          setMsgs((m) => m.map((x) => (x.id === tmpId ? { ...x, content: x.content + d } : x)));
        },
        ctrl.signal,
      );
      setMsgs((m) =>
        m.map((x) =>
          x.id === tmpId ? { ...x, id: done.id, content: done.content, streaming: false } : x,
        ),
      );
      setStatus((s) =>
        s
          ? {
              ...s,
              usage: done.usage,
              enabled: !aiBlocked(done.usage),
              reason: aiBlocked(done.usage) ? 'limit' : s.reason,
            }
          : s,
      );
      setMood('happy');
      setTimeout(() => setMood('idle'), 1600);
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setMsgs((m) =>
          m.map((x) =>
            x.id === tmpId ? { ...x, streaming: false, content: x.content || '(parei aqui)' } : x,
          ),
        );
        setMood('idle');
      } else {
        const msg = e instanceof ApiError ? e.message : 'Não consegui responder agora.';
        setMsgs((m) =>
          m.map((x) =>
            x.id === tmpId ? { ...x, streaming: false, error: true, content: msg } : x,
          ),
        );
        setMood('sad');
        setTimeout(() => setMood('idle'), 2500);
        if (e instanceof ApiError && (e.status === 429 || e.status === 503)) void load();
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(text);
    }
  };

  const name = status?.name ?? 'Comandinho';
  const off = status && !status.enabled;

  return (
    <div className="tc-page tc-ai">
      <header className="tc-ai__head">
        <LivePanda size={46} mood={off ? 'sleep' : mood} title={name} />
        <div className="tc-ai__who">
          <strong>{name}</strong>
          <small>
            {busy ? (mood === 'thinking' ? 'pensando…' : 'escrevendo…') : 'seu guia no Comandou'}
          </small>
        </div>
        <span className="tc-spacer" />
        {msgs.length > 0 && !busy && (
          <button
            className="tc-icon"
            title="Nova conversa"
            aria-label="Nova conversa"
            onClick={async () => {
              if (!confirm('Começar uma conversa nova? A atual será apagada.')) return;
              await chatApi.aiClear().catch(() => undefined);
              setMsgs([]);
            }}
          >
            <MessageSquarePlus size={18} />
          </button>
        )}
      </header>
      {status && (
        <UsageBar
          {...status.usage}
          more={
            canPlan ? (
              <Link to="/conta/uso-ia" onClick={onNavigate} className="tc-usage__more">
                Ver onde usou
              </Link>
            ) : undefined
          }
        />
      )}
      <div className="tc-ai__scroll" ref={scroller}>
        {off ? (
          <div className="tc-page__empty">
            <LivePanda size={96} mood="sleep" />
            <p>{name} está descansando</p>
            <small>{REASON[status.reason ?? 'platform']}</small>
          </div>
        ) : msgs.length === 0 ? (
          <div className="tc-ai__hello">
            <LivePanda size={104} mood={mood === 'idle' ? 'happy' : mood} />
            <p>
              Oi! Eu sou o <b>{name}</b>. Pergunte qualquer coisa sobre o Comandou que eu te guio
              passo a passo.
            </p>
            <div className="tc-ai__chips">
              {suggestionsFor(screen).map((s) => (
                <button key={s} className="tc-chip has" onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          msgs.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="tc-msg is-mine">
                <div className="tc-msg__side">
                  <Avatar name="Você" size={36} />
                </div>
                <div className="tc-msg__main">
                  <div className="tc-msg__head">
                    <span className="tc-msg__who">Você</span>
                  </div>
                  <span className="tc-msg__text">{m.content}</span>
                </div>
              </div>
            ) : (
              <div key={m.id} className={`tc-ai__answer ${m.error ? 'is-error' : ''}`}>
                <LivePanda size={28} mood={m.streaming ? 'talking' : 'idle'} still={!m.streaming} />
                <div className="tc-ai__text">
                  {m.content ? (
                    <Markdown text={m.content} onNavigate={onNavigate} autoLink />
                  ) : (
                    <span className="tc-typing tc-typing--inline">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                  {m.streaming && m.content && <span className="tc-caret" />}
                  {m.error && (
                    <button
                      className="tc-link"
                      onClick={() => {
                        const prev = msgs[msgs.findIndex((x) => x.id === m.id) - 1];
                        setMsgs((cur) => cur.filter((x) => x.id !== m.id && x.id !== prev?.id));
                        if (prev) void ask(prev.content);
                      }}
                    >
                      <RotateCcw size={13} /> Tentar de novo
                    </button>
                  )}
                </div>
              </div>
            ),
          )
        )}
      </div>
      <footer className="tc-composer">
        <div className="tc-composer__row">
          <textarea
            ref={area}
            className="tc-input"
            rows={1}
            placeholder={off ? 'Assistente indisponível' : `Pergunte ao ${name}…`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            maxLength={2000}
            disabled={!!off}
            aria-label="Pergunta para o assistente"
          />
          {busy ? (
            <button
              className="tc-send tc-send--stop"
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={() => abort.current?.abort()}
              aria-label="Parar"
            >
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              className="tc-send"
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={() => ask(text)}
              disabled={!text.trim() || !!off}
              aria-label="Perguntar"
            >
              <SendHorizontal size={19} />
            </button>
          )}
        </div>
        <small className="tc-ai__note">
          O assistente pode errar. Confira antes de mudar algo importante.
        </small>
      </footer>
    </div>
  );
}
