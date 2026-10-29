import { Bell, Maximize2, Megaphone, MessageCircle, Minimize2, Users, X } from 'lucide-react';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { LivePanda, useToast } from '../../design-system';
import { useRealtimeEvents } from '../../lib/realtime';
import { useAuth } from '../../app/auth';
import { chatApi, Conversation, Person } from './chat-api';
import { ConversationView } from './ConversationView';
import { ConversationList, NewConversation, PeopleList } from './Lists';
import { AiTab, MuralTab, NoticesTab } from './Tabs';
import { Avatar } from './util';
import './chat.css';

type Tab = 'conversas' | 'pessoas' | 'mural' | 'ia' | 'avisos';
/** Outras telas abrem o chat disparando este evento (detail: { tab }). */
export const OPEN_CHAT_EVENT = 'cm:open-chat';

const STORE = 'cm.chat';
function loadPrefs(): { tab?: Tab; expanded?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}
function savePrefs(p: { tab: Tab; expanded: boolean }) {
  try {
    localStorage.setItem(STORE, JSON.stringify(p));
  } catch {
    /* sem armazenamento: tudo bem */
  }
}

interface Peek {
  conversationId: string;
  name: string;
  body: string;
  seed: string;
}

/**
 * Chat interno da equipe, em todas as telas: botão redondo no canto que abre o painel com as
 * abas Conversas, Pessoas, Mural, IA e Avisos. No celular o painel ocupa a tela inteira.
 * `variant` ajusta a posição do botão para não cobrir a barra de baixo de cada app.
 */
export function TeamChat({
  variant = 'shell',
}: {
  variant?: 'shell' | 'waiter' | 'driver' | 'kitchen';
}) {
  const { me } = useAuth();
  const toast = useToast();
  const { pathname } = useLocation();
  const prefs = useRef(loadPrefs());
  const [open, setOpen] = useState(false);
  const [tab, setTabState] = useState<Tab>(prefs.current.tab ?? 'conversas');
  const [expanded, setExpandedState] = useState(!!prefs.current.expanded);
  // Só grava no armazenamento quando a pessoa muda algo (não ao abrir a página).
  const setTab = (t: Tab) => {
    setTabState(t);
    savePrefs({ tab: t, expanded });
  };
  const setExpanded = (e: boolean) => {
    setExpandedState(e);
    savePrefs({ tab, expanded: e });
  };
  const [selected, setSelected] = useState<string | null>(null);
  const [focusMsg, setFocusMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState<'group' | 'channel' | null>(null);
  const [newChat, setNewChat] = useState(false);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ unread: 0, notices: 0 });
  const [peek, setPeek] = useState<Peek | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const selRef = useRef(selected);
  selRef.current = selected;
  const myId = me?.user.id ?? '';
  // Entregador não usa o tempo real: confere mais vezes.
  const pollMs = variant === 'driver' ? 6000 : 20000;

  const loadSummary = useCallback(() => chatApi.summary().then(setSummary, () => undefined), []);
  const loadConvs = useCallback(
    () =>
      chatApi
        .conversations()
        .then(setConvs, () => undefined)
        .finally(() => setLoading(false)),
    [],
  );
  const loadPeople = useCallback(() => chatApi.people().then(setPeople, () => undefined), []);

  useEffect(() => {
    void loadSummary();
    const t = setInterval(() => {
      if (document.hidden) return;
      void loadSummary();
      if (openRef.current) void loadConvs();
    }, pollMs);
    return () => clearInterval(t);
  }, [loadSummary, loadConvs, pollMs]);

  useEffect(() => {
    if (!open) return;
    void loadConvs();
    void loadPeople();
  }, [open, loadConvs, loadPeople]);

  // Outras telas pedem para abrir o chat (ex.: o panda do topo abre a IA).
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<{ tab?: Tab }>).detail?.tab;
      if (t) setTab(t);
      setOpen(true);
    };
    window.addEventListener(OPEN_CHAT_EVENT, on);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, on);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement;
      if (t.closest('textarea, input')) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useRealtimeEvents((e) => {
    if (e.type === 'chat.message' || e.type === 'chat.changed' || e.type === 'chat.read') {
      void loadSummary();
      if (openRef.current) void loadConvs();
    }
    if (e.type === 'chat.notice') void loadSummary();
    // Mensagem nova de outra pessoa com o chat fechado: mostra uma prévia no canto.
    if (
      e.type === 'chat.message' &&
      e.authorId &&
      e.authorId !== myId &&
      (!openRef.current || selRef.current !== e.conversationId)
    ) {
      chatApi
        .conversations()
        .then((list) => {
          setConvs(list);
          const c = list.find((x) => x.id === e.conversationId);
          if (c && !c.muted && c.last && !c.last.system && !openRef.current)
            setPeek({
              conversationId: c.id,
              name: c.kind === 'direct' ? c.name : `${c.last.authorName ?? ''} · ${c.name}`,
              body: c.last.body,
              seed: c.peer?.id ?? c.id,
            });
        })
        .catch(() => undefined);
    }
  }, variant !== 'driver');
  useEffect(() => {
    if (!peek) return;
    const t = setTimeout(() => setPeek(null), 6000);
    return () => clearTimeout(t);
  }, [peek]);

  const openConversation = (id: string, messageId?: string) => {
    setNewChat(false);
    setCreating(null);
    setFocusMsg(messageId ?? null);
    setSelected(id);
    if (tab !== 'conversas' && tab !== 'pessoas') setTab('conversas');
    setOpen(true);
  };
  const direct = async (userId: string) => {
    try {
      const c = await chatApi.direct(userId);
      void loadConvs();
      openConversation(c.id);
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };

  if (!me) return null;
  const total = summary.unread + summary.notices;
  const listTab = tab === 'conversas' || tab === 'pessoas';

  const TABS: { key: Tab; label: string; icon: ReactNode; badge?: number }[] = [
    {
      key: 'conversas',
      label: 'Conversas',
      icon: <MessageCircle size={20} />,
      badge: summary.unread,
    },
    { key: 'pessoas', label: 'Pessoas', icon: <Users size={20} /> },
    { key: 'mural', label: 'Mural', icon: <Megaphone size={20} /> },
    { key: 'ia', label: 'IA', icon: <LivePanda size={24} still /> },
    { key: 'avisos', label: 'Avisos', icon: <Bell size={20} />, badge: summary.notices },
  ];

  let side: ReactNode = null;
  if (tab === 'conversas' && !newChat && !creating)
    side = (
      <ConversationList
        me={myId}
        items={convs}
        loading={loading}
        selected={selected}
        onOpen={openConversation}
        onNew={() => setNewChat(true)}
      />
    );
  else if (creating)
    side = (
      <NewConversation
        kind={creating}
        me={myId}
        people={people}
        onBack={() => setCreating(null)}
        onCreated={(c) => {
          void loadConvs();
          openConversation(c.id);
          setTab('conversas');
        }}
      />
    );
  else
    side = (
      <PeopleList
        me={myId}
        people={people}
        onDirect={direct}
        onOpen={(id) => {
          void loadConvs();
          openConversation(id);
        }}
        onCreate={setCreating}
        back={tab === 'conversas' ? () => setNewChat(false) : undefined}
      />
    );

  return (
    <>
      {peek && !open && (
        <button
          className={`tc-peek tc-peek--${variant}`}
          onClick={() => {
            setPeek(null);
            openConversation(peek.conversationId);
          }}
        >
          <Avatar name={peek.name} seed={peek.seed} size={34} />
          <span>
            <strong>{peek.name}</strong>
            <small>{peek.body}</small>
          </span>
          <X
            size={14}
            className="tc-peek__x"
            onClick={(e) => {
              e.stopPropagation();
              setPeek(null);
            }}
          />
        </button>
      )}
      <button
        className={`tc-fab tc-fab--${variant} ${open ? 'is-open' : ''}`}
        onClick={() => {
          setPeek(null);
          setOpen((v) => !v);
        }}
        aria-label={open ? 'Fechar chat da equipe' : 'Abrir chat da equipe'}
        aria-expanded={open}
      >
        {open ? <X size={22} /> : <MessageCircle size={24} />}
        {!open && total > 0 && <span className="tc-fab__badge">{total > 99 ? '99+' : total}</span>}
      </button>

      {open && (
        <div
          className={`tc-panel tc-panel--${variant} ${expanded ? 'is-expanded' : ''}`}
          role="dialog"
          aria-label="Chat da equipe"
          data-view={listTab && selected ? 'conv' : 'list'}
        >
          <header className="tc-panel__head">
            <strong>Chat da equipe</strong>
            <span className="tc-spacer" />
            <button
              className="tc-icon tc-hide-mobile"
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? 'Diminuir' : 'Aumentar'}
              title={expanded ? 'Diminuir' : 'Aumentar'}
            >
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              className="tc-icon"
              onClick={() => setOpen(false)}
              aria-label="Fechar"
              title="Fechar"
            >
              <X size={18} />
            </button>
          </header>
          <div className="tc-panel__body">
            <nav className="tc-tabs" aria-label="Seções do chat">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={`tc-tab ${tab === t.key ? 'is-active' : ''} ${t.key === 'ia' ? 'tc-tab--ai' : ''}`}
                  onClick={() => {
                    setTab(t.key);
                    setNewChat(false);
                    setCreating(null);
                    if (t.key === 'conversas' && tab === 'conversas') setSelected(null);
                  }}
                  aria-current={tab === t.key ? 'page' : undefined}
                >
                  <span className="tc-tab__icon">
                    {t.icon}
                    {!!t.badge && (
                      <span className="tc-tab__badge">{t.badge > 99 ? '99+' : t.badge}</span>
                    )}
                  </span>
                  <span className="tc-tab__label">{t.label}</span>
                </button>
              ))}
            </nav>
            {listTab ? (
              <div className="tc-split">
                <div className="tc-split__side">{side}</div>
                <div className="tc-split__main">
                  {selected ? (
                    <ConversationView
                      id={selected}
                      me={myId}
                      people={people}
                      pollMs={pollMs}
                      focusMessage={focusMsg}
                      onBack={() => setSelected(null)}
                      onLeft={() => {
                        setSelected(null);
                        void loadConvs();
                      }}
                      onChanged={() => {
                        void loadConvs();
                        void loadSummary();
                      }}
                    />
                  ) : (
                    <div className="tc-placeholder">
                      <LivePanda size={96} mood="happy" />
                      <p>Escolha uma conversa ou comece uma nova.</p>
                      <small>Fale com a equipe sem sair da tela em que você está.</small>
                    </div>
                  )}
                </div>
              </div>
            ) : tab === 'mural' ? (
              <MuralTab
                me={myId}
                canPin={!!me.permissions.includes('settings:manage')}
                pollMs={pollMs}
              />
            ) : tab === 'ia' ? (
              <AiTab screen={pathname} />
            ) : (
              <NoticesTab
                onOpenConversation={openConversation}
                onOpenMural={() => setTab('mural')}
                onChanged={() => void loadSummary()}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
