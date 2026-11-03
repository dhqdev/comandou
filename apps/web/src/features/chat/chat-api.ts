import { api, ApiError } from '../../lib/api';

/** Tipos e chamadas do chat da equipe e do assistente (ver apps/api/src/chat). */
export type Kind = 'direct' | 'group' | 'channel';

export interface Person {
  id: string;
  name: string;
  roleLabel: string;
  online: boolean;
  lastSeenAt: string | null;
}

export interface Conversation {
  id: string;
  kind: Kind;
  name: string;
  description: string | null;
  muted: boolean;
  pinned: boolean;
  myRole: 'admin' | 'member';
  memberCount: number;
  unread: number;
  updatedAt: string;
  peer: { id: string; name: string; roleLabel: string; online: boolean } | null;
  last: {
    body: string;
    authorId: string | null;
    authorName: string | null;
    system: boolean;
  } | null;
}

export interface Member {
  id: string;
  name: string;
  roleLabel: string;
  admin: boolean;
  online: boolean;
  lastReadAt: string | null;
}

export interface ConversationDetail extends Conversation {
  members: Member[];
}

export interface Message {
  id: string;
  conversationId: string;
  authorId: string | null;
  authorName: string | null;
  body: string;
  imageId: string | null;
  reply: { id: string; body: string | null; authorName: string | null } | null;
  reactions: Record<string, string[]>;
  system: boolean;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  /** Só na busca. */
  conversationName?: string | null;
  kind?: Kind;
  /** Enviando (ainda sem resposta do servidor). */
  pending?: boolean;
}

export interface Post {
  id: string;
  authorId: string | null;
  authorName: string | null;
  authorRole: string | null;
  body: string;
  imageId: string | null;
  pinned: boolean;
  reactions: Record<string, string[]>;
  createdAt: string;
}

export interface Notice {
  id: string;
  kind: 'mention' | 'group' | 'post' | 'ai' | 'system';
  title: string;
  body: string | null;
  conversationId: string | null;
  postId: string | null;
  createdAt: string;
  readAt: string | null;
  actorName: string | null;
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  streaming?: boolean;
  error?: boolean;
}

export interface AiUsage {
  used: number;
  limit: number;
  /** Tokens extras liberados pelo Comandou (gastos depois do limite do mês). */
  bonus?: number;
  /** Quanto ainda dá para usar (limite que sobra + extras); null = sem limite. */
  available?: number | null;
  percent: number | null;
}

export interface AiStatus {
  enabled: boolean;
  reason: 'platform' | 'tenant' | 'limit' | null;
  name: string;
  usage: AiUsage;
  messages: AiMessage[];
}

export const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏', '🔥', '✅'] as const;

const post = <T>(path: string, json: unknown = {}) => api<T>(path, { method: 'POST', json });

export const chatApi = {
  summary: () => api<{ unread: number; notices: number }>('/chat/summary'),
  people: () => api<Person[]>('/chat/people'),
  conversations: () => api<Conversation[]>('/chat/conversations'),
  channels: () =>
    api<{ id: string; name: string; description: string | null; memberCount: number }[]>(
      '/chat/channels',
    ),
  direct: (userId: string) => post<Conversation>('/chat/conversations/direct', { userId }),
  create: (b: {
    kind: 'group' | 'channel';
    name: string;
    description?: string;
    memberIds: string[];
  }) => post<Conversation>('/chat/conversations', b),
  detail: (id: string) => api<ConversationDetail>(`/chat/conversations/${id}`),
  update: (
    id: string,
    b: Partial<Pick<Conversation, 'name' | 'description' | 'muted' | 'pinned'>>,
  ) => api<Conversation>(`/chat/conversations/${id}`, { method: 'PATCH', json: b }),
  join: (id: string) => post<Conversation>(`/chat/conversations/${id}/join`),
  leave: (id: string) => post(`/chat/conversations/${id}/leave`),
  addMembers: (id: string, userIds: string[]) =>
    post<Conversation>(`/chat/conversations/${id}/members`, { userIds }),
  removeMember: (id: string, userId: string) =>
    api(`/chat/conversations/${id}/members/${userId}`, { method: 'DELETE' }),
  messages: (id: string, before?: string) =>
    api<{ messages: Message[]; more: boolean }>(
      `/chat/conversations/${id}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`,
    ),
  send: (
    id: string,
    b: { body: string; imageId?: string | null; replyTo?: string | null; mentions?: string[] },
  ) => post<Message>(`/chat/conversations/${id}/messages`, b),
  edit: (id: string, body: string) =>
    api<Message>(`/chat/messages/${id}`, { method: 'PATCH', json: { body } }),
  remove: (id: string) => api(`/chat/messages/${id}`, { method: 'DELETE' }),
  react: (id: string, emoji: string) => post<Message>(`/chat/messages/${id}/react`, { emoji }),
  read: (id: string) => post(`/chat/conversations/${id}/read`),
  typing: (id: string) => post(`/chat/conversations/${id}/typing`),
  search: (q: string) => api<Message[]>(`/chat/search?q=${encodeURIComponent(q)}`),
  posts: () => api<Post[]>('/chat/posts'),
  newPost: (body: string, imageId?: string | null) =>
    post<{ id: string }>('/chat/posts', { body, imageId }),
  reactPost: (id: string, emoji: string) => post(`/chat/posts/${id}/react`, { emoji }),
  pinPost: (id: string, pinned: boolean) => post(`/chat/posts/${id}/pin`, { pinned }),
  removePost: (id: string) => api(`/chat/posts/${id}`, { method: 'DELETE' }),
  notices: () => api<Notice[]>('/chat/notices'),
  readNotices: (ids?: string[]) => post('/chat/notices/read', ids ? { ids } : {}),
  ai: () => api<AiStatus>('/chat/ai'),
  aiClear: () => api('/chat/ai/messages', { method: 'DELETE' }),
};

/** Envia a foto já reduzida (mesmo preparo das fotos do cardápio) para o chat. */
export async function uploadChatImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('Não foi possível ler esta imagem');
  });
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.84));
  const out =
    blob && blob.type === 'image/webp'
      ? blob
      : await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
  if (!out) throw new Error('Não foi possível preparar a imagem');
  const res = await api<{ id: string }>('/chat/media', {
    method: 'POST',
    body: out,
    headers: { 'Content-Type': out.type },
  });
  return res.id;
}

/**
 * Pergunta ao assistente e recebe a resposta em pedaços (text/event-stream).
 * Erros antes do streaming (desligado, limite) chegam como ApiError.
 */
export async function askAi(
  content: string,
  screen: string,
  onDelta: (t: string) => void,
  signal?: AbortSignal,
): Promise<{ id: string; content: string; createdAt: string; usage: AiUsage }> {
  let res: Response;
  try {
    res = await fetch('/api/v1/chat/ai/messages', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Comandou-Request': '1',
      },
      body: JSON.stringify({ content, screen }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'Sem conexão com o servidor');
  }
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(
      res.status,
      (body as { message?: string } | undefined)?.message ?? `Erro ${res.status}`,
      body,
    );
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let done: Awaited<ReturnType<typeof askAi>> | null = null;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (!ev || !data) continue;
      const j = JSON.parse(data);
      if (ev === 'delta') onDelta(j.text);
      else if (ev === 'done') done = j;
      else if (ev === 'error') throw new ApiError(503, j.message);
    }
  }
  if (!done) throw new ApiError(503, 'A resposta foi interrompida');
  return done;
}
