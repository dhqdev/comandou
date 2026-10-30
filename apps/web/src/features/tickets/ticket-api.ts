import { ApiError } from '../../lib/api';
import type { Prepared } from '../store-chat/chat-media';

export interface TicketFile {
  id: string;
  kind: 'image' | 'video';
  name: string;
  size: number;
  eventId: number | null;
  uploadedBy: 'client' | 'admin';
  createdAt: string;
  url: string;
}

export interface TicketEvent {
  id: number;
  kind: 'message' | 'note' | 'activity' | 'stage' | 'status' | 'decision';
  actor: 'client' | 'admin' | 'agent' | 'system';
  actorName: string;
  stage?: string | null;
  body: string;
  data: Record<string, unknown>;
  public?: boolean;
  createdAt: string;
}

/**
 * Sobe uma foto (já reduzida) ou vídeo para o chamado. `base` é `/support/tickets` no restaurante
 * e `/platform/tickets` no painel.
 */
export async function uploadTicketFile(base: string, ticketId: string, f: Prepared) {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1${base}/${ticketId}/files?name=${encodeURIComponent(f.name.slice(0, 180))}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': f.blob.type,
          'X-Comandou-Request': '1',
          Accept: 'application/json',
        },
        body: f.blob,
      },
    );
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor');
  }
  const body = await res.json().catch(() => undefined);
  if (!res.ok)
    throw new ApiError(
      res.status,
      (body as { message?: string } | undefined)?.message ?? `Erro ${res.status}`,
    );
  return body as { id: string; kind: 'image' | 'video'; url: string };
}

export const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
