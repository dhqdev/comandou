import { api } from '../../lib/api';
import { mediaUrl } from '../../lib/media';

/** Loja do iFood ligada ao restaurante. */
export interface IfoodConnection {
  id: string;
  merchantId: string;
  merchantName: string;
  mode: 'centralized' | 'distributed';
  status: 'connected' | 'revoked';
  lastError: string | null;
  menuId: string | null;
}

export interface IfoodStatus {
  configured: boolean;
  mode: 'centralized' | 'distributed';
  keyConfigured: boolean;
}

export interface IfoodSummary {
  created: number;
  updated: number;
  unchanged: number;
  unavailable: number;
  failed: number;
  errors: { name: string; message: string }[];
  imagesPending: number;
}

export interface IfoodSyncState {
  syncedAt: string | null;
  startedAt: string | null;
  status: 'running' | 'ok' | 'partial' | 'error' | null;
  summary: IfoodSummary | null;
  text: string | null;
  merchantName: string | null;
  connectionId: string | null;
  connectionStatus: 'connected' | 'revoked' | null;
  pendingImages?: string[];
  busy?: boolean;
}

export const ifoodLabel = (c: Pick<IfoodConnection, 'merchantName'>) => `iFood · ${c.merchantName}`;

/** O iFood só aceita JPG/PNG: as fotos do Comandou (WebP) viram JPG aqui no navegador. */
export async function toJpeg(mediaId: string, max = 1200): Promise<Blob | null> {
  try {
    const res = await fetch(mediaUrl(mediaId)!, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  } catch {
    return null;
  }
}

/** Sincroniza agora: converte e sobe as fotos pendentes e manda o cardápio. */
export async function syncNow(menuId: string, pending: string[]) {
  for (const id of pending.slice(0, 200)) {
    const jpg = await toJpeg(id);
    if (!jpg || jpg.size > 3 * 1024 * 1024) continue;
    await api(`/ifood/menus/${menuId}/images/${id}`, {
      method: 'POST',
      body: jpg,
      headers: { 'Content-Type': 'image/jpeg' },
    }).catch(() => undefined);
  }
  return api<IfoodSyncState>(`/ifood/menus/${menuId}/sync`, { method: 'POST' });
}
