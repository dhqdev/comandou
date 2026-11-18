import {
  Bell,
  LifeBuoy,
  Maximize2,
  Megaphone,
  MessageCircle,
  Minimize2,
  ShoppingBag,
  Users,
  X,
} from 'lucide-react';
import { ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';
import { BRAND_CACHED_EVENT, cachedBranding, LivePanda, useToast } from '../../design-system';
import { useRealtimeEvents } from '../../lib/realtime';
import { useAuth } from '../../app/auth';
import { api } from '../../lib/api';
import { chatApi, Conversation, Person } from './chat-api';
import { ConversationView } from './ConversationView';
import { HelpTab } from './HelpTab';
import { ConversationList, NewConversation, PeopleList } from './Lists';
import { AiTab, MuralTab, NoticesTab } from './Tabs';
import { CustomersInbox, useSupportUnread } from '../store-chat/SupportInbox';
import type { ChatTicket } from '../store-chat/chat-media';
import { Avatar } from './util';
import './chat.css';

type Tab = 'conversas' | 'pessoas' | 'mural' | 'ia' | 'avisos' | 'clientes' | 'suporte';
/** Outras telas abrem o chat disparando este evento (detail: { tab }). */
export const OPEN_CHAT_EVENT = 'cm:open-chat';

/**
 * Abre o chat da equipe de qualquer lugar (ex.: "Conversas" na folha Mais do celular).
 * `'ia'` abre só o assistente, num painel próprio, sem as outras abas.
 */
export function openTeamChat(tab?: Tab, opts?: { toggle?: boolean; ticket?: ChatTicket }) {
  window.dispatchEvent(
    new CustomEvent(OPEN_CHAT_EVENT, {
      detail: { tab, toggle: opts?.toggle, ticket: opts?.ticket },
    }),
  );
}

/** Abre a aba Suporte com o chamado já citado na próxima mensagem. */
export const talkAboutTicket = (ticket: ChatTicket) => openTeamChat('suporte', { ticket });

// Mensagens e avisos não lidos, para as bolinhas do "Conversas" e dos botões do topo no celular.
// `team`: conversas e avisos da equipe; `help`: suporte da Comandou (`helpOn`: a pessoa tem o
// suporte, ou seja, é dono ou gerente e o servidor tem o painel).
export interface ChatUnread {
  team: number;
  help: number;
  helpOn: boolean;
}
let unreadState: ChatUnread = { team: 0, help: 0, helpOn: false };
const unreadSubs = new Set<() => void>();
function setUnread(n: ChatUnread) {
  const o = unreadState;
  if (n.team === o.team && n.help === o.help && n.helpOn === o.helpOn) return;
  unreadState = n;
  unreadSubs.forEach((f) => f());
}
const subscribeUnread = (f: () => void) => {
  unreadSubs.add(f);
  return () => {
    unreadSubs.delete(f);
  };
};
/** Separado por origem (equipe e suporte da Comandou). */
export function useChatUnreadParts() {
  return useSyncExternalStore(subscribeUnread, () => unreadState);
}
/** Total de não lidos do chat (equipe + suporte). */
export function useChatUnread() {
  return useSyncExternalStore(subscribeUnread, () => unreadState.team + unreadState.help);
}

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

/** Ícone do restaurante (favicon, ou a logo se não tiver): no lugar do panda no chat vazio. */
function useStoreIcon() {
  const pick = () => cachedBranding()?.faviconUrl ?? cachedBranding()?.logoUrl ?? null;
  const [icon, setIcon] = useState(pick);
  useEffect(() => {
    const sync = () => setIcon(pick());
    window.addEventListener(BRAND_CACHED_EVENT, sync);
    return () => window.removeEventListener(BRAND_CACHED_EVENT, sync);
  }, []);
  return icon;
}

function EmptyIcon() {
  const icon = useStoreIcon();
  const [broken, setBroken] = useState<string | null>(null);
  if (!icon || broken === icon) return <LivePanda size={96} mood="happy" />;
  return (
    <img
      className="tc-placeholder__logo"
      src={icon}
      alt=""
      width={80}
      height={80}
      decoding="async"
      onError={() => setBroken(icon)}
    />
  );
}

interface Peek {
  conversationId: string;
  name: string;
  body: string;
  seed: string;
}

/**
 * Chat interno da equipe, em todas as telas: botão redondo no canto que abre o painel com as
 * abas Conversas, Pessoas, Mural, IA, Avisos e Suporte (dono e gerente falam com a Comandou).
 * No celular o painel ocupa a tela inteira.
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
  // No painel do restaurante a IA tem botão próprio no topo e abre sozinha, sem as abas.
  const shell = variant === 'shell';
  const [aiOnly, setAiOnly] = useState(false);
  const savedTab = prefs.current.tab;
  const [tab, setTabState] = useState<Tab>(
    savedTab && !(shell && savedTab === 'ia') ? savedTab : 'conversas',
  );
  // Ao abrir pelo "Chat" do topo, entra direto na conversa mais recente (no computador).
  const enter = useRef(false);
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
  const [helpTicket, setHelpTicket] = useState<ChatTicket | null>(null);
  const aiOnlyRef = useRef(aiOnly);
  aiOnlyRef.current = aiOnly;
  const selRef = useRef(selected);
  selRef.current = selected;
  const myId = me?.user.id ?? '';
  // Entregador não usa o tempo real: confere mais vezes.
  const pollMs = variant === 'driver' ? 6000 : 20000;

  // Suporte da Comandou: só quem vê o plano (dono e gerente), e só se o servidor tiver o painel.
  const canHelp = !!me?.permissions.includes('plan:read');
  const [help, setHelp] = useState({ available: false, unread: 0 });
  const loadHelp = useCallback(() => {
    if (!canHelp) return Promise.resolve();
    return api<{ available: boolean; unread: number }>('/help/chat/unread').then(
      (h) => setHelp({ available: h.available, unread: h.unread }),
      () => undefined,
    );
  }, [canHelp]);
  const loadSummary = useCallback(() => {
    void loadHelp();
    return chatApi.summary().then(setSummary, () => undefined);
  }, [loadHelp]);
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
      const detail = (e as CustomEvent<{ tab?: Tab; toggle?: boolean; ticket?: ChatTicket }>)
        .detail;
      const t = detail?.tab;
      if (detail?.ticket) setHelpTicket(detail.ticket);
      // Botão do topo com o painel já aberto no mesmo modo: fecha (liga e desliga).
      if (detail?.toggle && openRef.current && (t === 'ia') === aiOnlyRef.current) {
        setOpen(false);
        return;
      }
      if (shell && t === 'ia') {
        setAiOnly(true);
        setOpen(true);
        return;
      }
      setAiOnly(false);
      if (t) setTab(t);
      else if (shell) setTabState((cur) => (cur === 'ia' ? 'conversas' : cur));
      enter.current = !t || t === 'conversas';
      setOpen(true);
    };
    window.addEventListener(OPEN_CHAT_EVENT, on);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, on);
  }, []);

  useEffect(() => {
    if (!open || aiOnly || !enter.current || loading || selected) return;
    if (tab !== 'conversas' || !convs.length) return;
    enter.current = false;
    if (!window.matchMedia?.('(min-width: 721px)').matches) return;
    const first = convs.find((c) => c.unread > 0) ?? convs[0];
    setSelected(first.id);
  }, [open, aiOnly, loading, selected, tab, convs]);

  // Fecha no Esc (até escrevendo) e num clique fora do painel, como o David pediu. Não fecha
  // quando o clique ou o Esc são de outra camada por cima (foto ampliada, janela, menu, aviso)
  // nem nos botões que abrem o chat (eles cuidam de abrir e fechar).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('dialog[open]')) return;
      setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.isConnected) return;
      if (
        t.closest('.tc-panel, .tc-fab, .tc-top, .tc-peek, dialog, [role="dialog"], [role="menu"]')
      )
        return;
      if (t.closest('.cm-toasts, [data-chat-keep]')) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  useRealtimeEvents((e) => {
    if (e.type === 'chat.message' || e.type === 'chat.changed' || e.type === 'chat.read') {
      void loadSummary();
      if (openRef.current) void loadConvs();
    }
    if (e.type === 'chat.notice') void loadSummary();
    if (e.type === 'help.message' && e.sender === 'admin') void loadHelp();
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
  });
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
    setAiOnly(false);
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

  const helpUnread = help.available && tab !== 'suporte' ? help.unread : 0;
  const total = summary.unread + summary.notices + (open && tab === 'suporte' ? 0 : help.unread);
  const helpPart = open && tab === 'suporte' ? 0 : help.unread;
  const helpOn = canHelp && help.available;
  useEffect(
    () => setUnread({ team: summary.unread + summary.notices, help: helpPart, helpOn }),
    [summary.unread, summary.notices, helpPart, helpOn],
  );
  useEffect(() => () => setUnread({ team: 0, help: 0, helpOn: false }), []);
  const customers = useSupportUnread();
  if (!me) return null;
  const canCustomers = shell && me.permissions.includes('orders:manage');
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
    ...(shell ? [] : [{ key: 'ia' as const, label: 'IA', icon: <LivePanda size={24} still /> }]),
    { key: 'avisos', label: 'Avisos', icon: <Bell size={20} />, badge: summary.notices },
    ...(canCustomers
      ? [
          {
            key: 'clientes' as const,
            label: 'Clientes',
            icon: <ShoppingBag size={20} />,
            badge: customers.chats,
          },
        ]
      : []),
    ...(canHelp && help.available
      ? [
          {
            key: 'suporte' as const,
            label: 'Suporte',
            icon: <LifeBuoy size={20} />,
            badge: helpUnread,
          },
        ]
      : []),
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
        {open ? <X size={18} /> : <MessageCircle size={20} />}
        {!open && total > 0 && <span className="tc-fab__badge">{total > 99 ? '99+' : total}</span>}
      </button>

      {open && aiOnly && (
        <div
          className={`tc-panel tc-panel--${variant} tc-panel--ai`}
          role="dialog"
          aria-label="Assistente de IA"
        >
          <header className="tc-panel__head">
            <span className="tc-panel__ai-icon" aria-hidden>
              <LivePanda size={22} still />
            </span>
            <strong>Assistente de IA</strong>
            <span className="tc-spacer" />
            <button
              className="tc-icon"
              onClick={() => setOpen(false)}
              aria-label="Fechar"
              title="Fechar"
            >
              <X size={18} />
            </button>
          </header>
          <div className="tc-panel__body tc-panel__body--solo">
            <AiTab
              screen={pathname}
              onNavigate={() => {
                if (window.matchMedia?.('(max-width: 640px)').matches) setOpen(false);
              }}
            />
          </div>
        </div>
      )}
      {open && !aiOnly && (
        <div
          className={`tc-panel tc-panel--${variant} ${expanded ? 'is-expanded' : ''}`}
          role="dialog"
          aria-label="Chat da equipe"
          data-view={listTab && selected ? 'conv' : 'list'}
        >
          <header className="tc-panel__head">
            <strong>{shell ? 'Chat' : 'Chat da equipe'}</strong>
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
                      <EmptyIcon />
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
              <AiTab
                screen={pathname}
                // Link do assistente para uma tela: no celular (ou com o chat ampliado) o painel
                // cobre a tela, então fecha para a pessoa ver onde chegou.
                onNavigate={() => {
                  if (expanded || window.matchMedia?.('(max-width: 640px)').matches) setOpen(false);
                }}
              />
            ) : tab === 'clientes' && canCustomers ? (
              <CustomersInbox />
            ) : tab === 'suporte' && canHelp ? (
              <HelpTab
                pollMs={pollMs}
                onRead={() => setHelp((h) => ({ ...h, unread: 0 }))}
                ticket={helpTicket}
                onTicket={() => {
                  if (window.matchMedia?.('(max-width: 640px)').matches) setOpen(false);
                }}
              />
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
