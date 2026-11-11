import { Box, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, useToast } from '../design-system';
import { api, ApiError } from '../lib/api';
import './item-3d.css';

interface ModelFile {
  size: number;
  url: string;
}
interface ModelInfo {
  glb: ModelFile | null;
  usdz: ModelFile | null;
}
type Format = 'glb' | 'usdz';

const TYPES: Record<Format, string> = { glb: 'model/gltf-binary', usdz: 'model/vnd.usdz+zip' };
const MAX = 12 * 1024 * 1024;
const mb = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

async function sendModel(productId: string, format: Format, file: File): Promise<ModelInfo> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/products/${productId}/model/${format}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'Content-Type': TYPES[format],
        'X-Comandou-Request': '1',
        Accept: 'application/json',
      },
      body: file,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor');
  }
  const body = (await res.json().catch(() => undefined)) as
    (ModelInfo & { message?: string }) | undefined;
  if (!res.ok) throw new ApiError(res.status, body?.message ?? `Erro ${res.status}`);
  return body as ModelInfo;
}

/**
 * Item em 3D: o restaurante escaneia o prato com um aplicativo de celular e envia o arquivo
 * aqui. No cardápio online aparece "Ver em 3D" e o cliente vê o prato na mesa dele pela câmera.
 */
export function Item3DCard({ productId, canWrite }: { productId: string; canWrite: boolean }) {
  const toast = useToast();
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [busy, setBusy] = useState<Format | 'remove' | null>(null);
  const inputs = { glb: useRef<HTMLInputElement>(null), usdz: useRef<HTMLInputElement>(null) };

  useEffect(() => {
    let alive = true;
    api<ModelInfo>(`/products/${productId}/model`).then(
      (m) => alive && setInfo(m),
      () => alive && setInfo({ glb: null, usdz: null }),
    );
    return () => {
      alive = false;
    };
  }, [productId]);

  async function pick(format: Format, file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(`.${format}`))
      return toast(`Escolha um arquivo .${format}`, 'danger');
    if (file.size > MAX)
      return toast(
        `O arquivo tem ${mb(file.size)}. O limite é 12 MB: exporte com menos detalhe.`,
        'danger',
      );
    setBusy(format);
    try {
      setInfo(await sendModel(productId, format, file));
      toast(
        format === 'glb'
          ? 'Modelo 3D enviado. Já aparece no cardápio.'
          : 'Arquivo do iPhone enviado.',
        'success',
      );
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('remove');
    try {
      setInfo(await api<ModelInfo>(`/products/${productId}/model`, { method: 'DELETE' }));
      toast('Modelo 3D removido', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  const row = (format: Format, title: string, hint: string) => {
    const f = info?.[format];
    return (
      <div className="i3d__row">
        <div className="i3d__text">
          <strong>{title}</strong>
          <span className="cm-hint">{f ? `Enviado · ${mb(f.size)}` : hint}</span>
        </div>
        {canWrite && (
          <>
            <input
              ref={inputs[format]}
              type="file"
              accept={`.${format},${TYPES[format]}`}
              hidden
              onChange={(e) => {
                void pick(format, e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              icon={<Upload size={15} />}
              loading={busy === format}
              disabled={busy !== null}
              onClick={() => inputs[format].current?.click()}
            >
              {f ? 'Trocar' : `Enviar .${format}`}
            </Button>
          </>
        )}
      </div>
    );
  };

  return (
    <Card
      title={
        <span className="i3d__title">
          <Box size={17} aria-hidden /> Item em 3D
        </span>
      }
    >
      <div className="i3d">
        <p className="cm-hint i3d__lead">
          O cliente abre o item no cardápio, toca em “Ver em 3D” e vê o prato em cima da mesa dele
          pela câmera do celular. Para criar o modelo, escaneie o prato pronto com um aplicativo
          gratuito (Polycam, Scaniverse ou Luma), exporte e envie o arquivo aqui.
        </p>
        {row('glb', 'Modelo (.glb)', 'Obrigatório. Funciona em qualquer celular e no computador.')}
        {row(
          'usdz',
          'iPhone (.usdz)',
          'Opcional. Sem ele, o iPhone gera na hora a partir do .glb (demora um pouco mais).',
        )}
        {canWrite && (info?.glb || info?.usdz) && (
          <div className="i3d__foot">
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={15} />}
              loading={busy === 'remove'}
              disabled={busy !== null}
              onClick={remove}
            >
              Remover o modelo
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
