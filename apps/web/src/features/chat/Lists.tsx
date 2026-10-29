import {
  ArrowLeft,
  BellOff,
  Hash,
  Megaphone,
  Pin,
  Search,
  SquarePen,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../design-system';
import { chatApi, Conversation, Message, Person } from './chat-api';
import { Avatar, shortWhen } from './util';

/** Aba Conversas: busca nas mensagens e lista com a última mensagem e os não lidos. */
export function ConversationList({
  me,
  items,
  loading,
  selected,
  onOpen,
  onNew,
}: {
  me: string;
  items: Conversation[];
  loading: boolean;
  selected: string | null;
  onOpen: (id: string, messageId?: string) => void;
  onNew: () => void;
}) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Message[] | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setFound(null);
      return;
    }
    const t = setTimeout(() => {
      chatApi.search(term).then(setFound, () => setFound([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const term = q.trim().toLowerCase();
  const shown = term ? items.filter((c) => c.name.toLowerCase().includes(term)) : items;

  return (
    <div className="tc-list">
      <div className="tc-list__search">
        <label className="tc-search">
          <Search size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar conversas e mensagens"
            aria-label="Buscar conversas e mensagens"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Limpar busca">
              <X size={14} />
            </button>
          )}
        </label>
        <button
          className="tc-icon"
          onClick={onNew}
          aria-label="Nova conversa"
          title="Nova conversa"
        >
          <SquarePen size={18} />
        </button>
      </div>
      <div className="tc-list__scroll">
        {shown.map((c) => (
          <button
            key={c.id}
            className={`tc-row ${selected === c.id ? 'is-active' : ''} ${c.unread ? 'is-unread' : ''}`}
            onClick={() => onOpen(c.id)}
          >
            <Avatar
              name={c.name}
              seed={c.peer?.id ?? c.id}
              kind={c.kind}
              online={c.kind === 'direct' ? c.peer?.online : undefined}
              size={44}
            />
            <span className="tc-row__main">
              <span className="tc-row__top">
                <strong>{c.name}</strong>
                {c.pinned && <Pin size={12} className="tc-row__flag" />}
                {c.muted && <BellOff size={12} className="tc-row__flag" />}
                <time>{shortWhen(c.updatedAt)}</time>
              </span>
              <span className="tc-row__bottom">
                <span className="tc-row__last">
                  {c.last
                    ? `${c.last.system ? '' : c.last.authorId === me ? 'Você: ' : c.kind !== 'direct' && c.last.authorName ? `${c.last.authorName.split(' ')[0]}: ` : ''}${c.last.body}`
                    : c.kind === 'direct'
                      ? c.peer?.roleLabel
                      : `${c.memberCount} pessoas`}
                </span>
                {c.unread > 0 && (
                  <span className={`tc-count ${c.muted ? 'is-muted' : ''}`}>
                    {c.unread > 99 ? '99+' : c.unread}
                  </span>
                )}
              </span>
            </span>
          </button>
        ))}
        {!loading && items.length === 0 && (
          <div className="tc-list__empty">
            <p>Nenhuma conversa ainda.</p>
            <button className="tc-btn" onClick={onNew}>
              Começar uma conversa
            </button>
          </div>
        )}
        {found && (
          <>
            <div className="tc-list__label">Mensagens</div>
            {found.length === 0 && <div className="tc-list__hint">Nada encontrado.</div>}
            {found.map((m) => (
              <button
                key={m.id}
                className="tc-row tc-row--found"
                onClick={() => onOpen(m.conversationId, m.id)}
              >
                <Avatar name={m.authorName} seed={m.authorId ?? m.id} size={34} />
                <span className="tc-row__main">
                  <span className="tc-row__top">
                    <strong>
                      {m.authorName}
                      {m.kind !== 'direct' && m.conversationName ? ` · ${m.conversationName}` : ''}
                    </strong>
                    <time>{shortWhen(m.createdAt)}</time>
                  </span>
                  <span className="tc-row__last">{m.body}</span>
                </span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** Aba Pessoas: novo grupo, novo canal, canais abertos e a equipe (abre a conversa direta). */
export function PeopleList({
  me,
  people,
  onDirect,
  onOpen,
  onCreate,
  back,
}: {
  me: string;
  people: Person[];
  onDirect: (userId: string) => void;
  onOpen: (id: string) => void;
  onCreate: (kind: 'group' | 'channel') => void;
  back?: () => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [channels, setChannels] = useState<
    { id: string; name: string; description: string | null; memberCount: number }[]
  >([]);
  useEffect(() => {
    chatApi.channels().then(setChannels, () => undefined);
  }, []);
  const term = q.trim().toLowerCase();
  const list = useMemo(
    () =>
      people
        .filter((p) => p.id !== me)
        .filter(
          (p) =>
            !term ||
            p.name.toLowerCase().includes(term) ||
            p.roleLabel.toLowerCase().includes(term),
        )
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
    [people, me, term],
  );
  return (
    <div className="tc-list">
      {back && (
        <div className="tc-list__title">
          <button className="tc-icon" onClick={back} aria-label="Voltar">
            <ArrowLeft size={18} />
          </button>
          <strong>Nova conversa</strong>
        </div>
      )}
      <div className="tc-list__search">
        <label className="tc-search">
          <Search size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar pessoas"
            aria-label="Buscar pessoas"
          />
        </label>
      </div>
      <div className="tc-list__scroll">
        <button className="tc-row tc-row--action" onClick={() => onCreate('group')}>
          <span className="tc-action-icon">
            <Users size={20} />
          </span>
          <span className="tc-row__main">
            <strong>Novo grupo</strong>
            <span className="tc-row__last">conversa com as pessoas que você escolher</span>
          </span>
        </button>
        <button className="tc-row tc-row--action" onClick={() => onCreate('channel')}>
          <span className="tc-action-icon">
            <Megaphone size={20} />
          </span>
          <span className="tc-row__main">
            <strong>Novo canal</strong>
            <span className="tc-row__last">assunto aberto para quem quiser entrar</span>
          </span>
        </button>
        {channels.length > 0 && !term && (
          <>
            <div className="tc-list__label">Canais abertos</div>
            {channels.map((c) => (
              <div key={c.id} className="tc-row tc-row--static">
                <Avatar name={c.name} seed={c.id} kind="channel" size={40} />
                <span className="tc-row__main">
                  <strong>{c.name}</strong>
                  <span className="tc-row__last">
                    {c.description ||
                      `${c.memberCount} ${c.memberCount === 1 ? 'pessoa' : 'pessoas'}`}
                  </span>
                </span>
                <button
                  className="tc-btn tc-btn--sm"
                  onClick={async () => {
                    try {
                      const conv = await chatApi.join(c.id);
                      setChannels((cur) => cur.filter((x) => x.id !== c.id));
                      onOpen(conv.id);
                    } catch (e) {
                      toast((e as Error).message, 'danger');
                    }
                  }}
                >
                  Entrar
                </button>
              </div>
            ))}
          </>
        )}
        <div className="tc-list__label">Pessoas</div>
        {list.map((p) => (
          <button key={p.id} className="tc-row" onClick={() => onDirect(p.id)}>
            <Avatar name={p.name} seed={p.id} size={42} online={p.online} />
            <span className="tc-row__main">
              <strong>{p.name}</strong>
              <span className="tc-row__last">
                {p.roleLabel}
                {p.online ? ' · online' : ''}
              </span>
            </span>
          </button>
        ))}
        {list.length === 0 && (
          <div className="tc-list__hint">
            {term
              ? 'Ninguém com esse nome.'
              : 'Cadastre a equipe em Gestão › Equipe para conversar.'}
          </div>
        )}
      </div>
    </div>
  );
}

/** Formulário de novo grupo ou canal (nome, descrição e quem participa). */
export function NewConversation({
  kind,
  me,
  people,
  onBack,
  onCreated,
}: {
  kind: 'group' | 'channel';
  me: string;
  people: Person[];
  onBack: () => void;
  onCreated: (c: Conversation) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const others = people.filter(
    (p) => p.id !== me && p.name.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const ok = name.trim() && (kind === 'channel' || pick.length > 0);
  const create = async () => {
    setBusy(true);
    try {
      const c = await chatApi.create({
        kind,
        name: name.trim(),
        description: desc.trim() || undefined,
        memberIds: pick,
      });
      onCreated(c);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tc-list tc-new">
      <div className="tc-list__title">
        <button className="tc-icon" onClick={onBack} aria-label="Voltar">
          <ArrowLeft size={18} />
        </button>
        <strong>{kind === 'group' ? 'Novo grupo' : 'Novo canal'}</strong>
      </div>
      <div className="tc-list__scroll tc-new__body">
        <div className="tc-new__hero">
          <Avatar name={name || '?'} seed={name || 'novo'} kind={kind} size={56} />
          <div className="tc-new__fields">
            <input
              className="tc-field"
              placeholder={
                kind === 'group'
                  ? 'Nome do grupo (ex.: Turno da noite)'
                  : 'Nome do canal (ex.: Avisos da cozinha)'
              }
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <input
              className="tc-field"
              placeholder="Descrição (opcional)"
              value={desc}
              maxLength={200}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>
        </div>
        <div className="tc-list__label">
          {kind === 'group' ? 'Quem participa' : 'Chamar já algumas pessoas (opcional)'}
          {pick.length > 0 && <span> · {pick.length}</span>}
        </div>
        <label className="tc-search tc-search--inline">
          <Search size={15} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar"
            aria-label="Buscar pessoas"
          />
        </label>
        {others.map((p) => (
          <label key={p.id} className="tc-row tc-check">
            <input
              type="checkbox"
              checked={pick.includes(p.id)}
              onChange={(e) =>
                setPick((cur) =>
                  e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id),
                )
              }
            />
            <Avatar name={p.name} seed={p.id} size={36} online={p.online} />
            <span className="tc-row__main">
              <strong>{p.name}</strong>
              <span className="tc-row__last">{p.roleLabel}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="tc-new__foot">
        <button className="tc-btn tc-btn--block" disabled={!ok || busy} onClick={create}>
          {kind === 'group' ? <Users size={16} /> : <Hash size={16} />}
          {kind === 'group' ? 'Criar grupo' : 'Criar canal'}
        </button>
      </div>
    </div>
  );
}
