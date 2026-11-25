import { Box, Camera, Check, ImageIcon, RefreshCw, Trash2, Upload, Wand2 } from 'lucide-react';
import { createElement, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, useToast } from '../design-system';
import { api, ApiError } from '../lib/api';
import { loadModelViewer } from '../lib/model-viewer';
import {
  canvasOf,
  generate3D,
  glbBlob,
  jpegOf,
  loadBitmap,
  useCatalogAi,
  type DishKind,
  type DishShape,
  type Generated3D,
} from './item-ai';
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

/** Formas que o servidor monta, na ordem do seletor. */
export const KINDS: [DishKind, string][] = [
  ['plate', 'Prato'],
  ['bowl', 'Tigela ou cumbuca'],
  ['glass', 'Copo ou taça'],
  ['cup', 'Xícara ou caneca'],
  ['stack', 'Lanche ou bolo alto'],
  ['slice', 'Fatia'],
  ['box', 'Embalagem'],
  ['other', 'Outro'],
];
const VIEWS: [DishShape['view'], string][] = [
  ['angle', 'De lado, inclinada (45°)'],
  ['top', 'De cima'],
  ['side', 'Bem de lado, na altura da mesa'],
];
const tall = (k: DishKind) => k === 'glass' || k === 'cup' || k === 'stack';

/** Forma inicial quando a IA não está liberada: um prato de 26 cm visto de lado. */
export function manualShape(kind: DishKind = 'plate'): DishShape {
  return {
    kind,
    view: tall(kind) ? 'side' : 'angle',
    box: { x0: 0.08, y0: 0.12, x1: 0.92, y1: 0.88 },
    food: null,
    diameterCm: tall(kind) ? 9 : kind === 'bowl' ? 16 : 26,
    heightCm: tall(kind) ? 12 : kind === 'bowl' ? 8 : 3,
    foodHeightCm: kind === 'plate' ? 3 : 2,
    profile: null,
  };
}

async function sendModel(productId: string, format: Format, file: Blob): Promise<ModelInfo> {
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

/** O modelo girando na tela (o mesmo visualizador do cardápio do cliente). */
function Preview({ src, name }: { src: string; name: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let alive = true;
    loadModelViewer().then(
      () => alive && setState('ready'),
      () => alive && setState('error'),
    );
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="i3d__stage">
      {state === 'error' ? (
        <p className="cm-hint i3d__stage-note">Não deu para abrir o visualizador 3D.</p>
      ) : state === 'loading' ? (
        <p className="cm-hint i3d__stage-note">Abrindo o 3D…</p>
      ) : (
        createElement('model-viewer', {
          class: 'i3d__viewer',
          src,
          alt: `${name} em 3D`,
          'camera-controls': '',
          'auto-rotate': '',
          'camera-orbit': '0deg 60deg auto',
          'shadow-intensity': '1',
          exposure: '1.05',
          'touch-action': 'pan-y',
          'interaction-prompt': 'none',
        })
      )}
    </div>
  );
}

/**
 * Item em 3D pela foto: a IA barata lê a forma do prato (Super Admin › Tokens liga e escolhe o
 * modelo) e o servidor monta o GLB com a própria foto. A pessoa vê girando, ajusta a forma se
 * precisar (sem gastar IA) e publica. No cardápio o cliente toca em "Ver em 3D" e, pela câmera do
 * celular, vê o prato em cima da mesa, em tamanho real. Quem já tem o arquivo ainda pode enviar.
 */
export function Item3DCard({
  productId,
  canWrite,
  imageId,
  itemName,
}: {
  productId: string;
  canWrite: boolean;
  imageId: string | null;
  itemName: string;
}) {
  const toast = useToast();
  const ai = useCatalogAi(canWrite);
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [busy, setBusy] = useState<Format | 'remove' | 'make' | 'publish' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [made, setMade] = useState<Generated3D | null>(null);
  const [shape, setShape] = useState<DishShape | null>(null);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [showLive, setShowLive] = useState(false);
  const inputs = { glb: useRef<HTMLInputElement>(null), usdz: useRef<HTMLInputElement>(null) };
  const camera = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!photo) return setPhotoUrl(null);
    const u = URL.createObjectURL(photo);
    setPhotoUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);

  useEffect(() => {
    if (!made) return setGlbUrl(null);
    const u = URL.createObjectURL(glbBlob(made.glb));
    setGlbUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [made]);

  /** A foto do item (ou a escolhida) em JPEG de até 1024 px: vira a textura do modelo. */
  async function prepare(src: Blob | string): Promise<Blob> {
    const bmp = await loadBitmap(src);
    try {
      return await jpegOf(canvasOf(bmp, 1024), 0.86);
    } finally {
      bmp.close();
    }
  }

  async function make(src: Blob | string | null, again?: DishShape) {
    setError(null);
    setBusy('make');
    try {
      const jpg = src ? await prepare(src) : photo;
      if (!jpg) throw new Error('Escolha a foto do item');
      setPhoto(jpg);
      // Sem a IA liberada, monta com a forma escolhida na tela (prato, por padrão).
      const useShape = again ?? (ai?.model3d ? undefined : (shape ?? manualShape()));
      const r = await generate3D(productId, jpg, useShape);
      setMade(r);
      setShape(r.shape);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (!made) return;
    setBusy('publish');
    setError(null);
    try {
      setInfo(await sendModel(productId, 'glb', glbBlob(made.glb)));
      setMade(null);
      setShape(null);
      setPhoto(null);
      toast('3D publicado. Já aparece no cardápio.', 'success');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

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
      setShowLive(false);
      toast('Modelo 3D removido', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  const edit = <K extends keyof DishShape>(k: K, v: DishShape[K]) =>
    setShape((s) => (s ? { ...s, [k]: v } : s));
  const working = busy !== null;
  const aiReady = !!ai?.model3d;

  const fileRow = (format: Format, title: string, hint: string) => {
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
              disabled={working}
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
          No cardápio, o cliente toca em “Ver em 3D”, gira o prato com o dedo e, pela câmera do
          celular, vê ele em cima da mesa em tamanho real. Monte pela foto do item: a IA lê a forma
          e o Comandou monta o 3D com a própria foto. Aparece só no celular e no tablet.
        </p>

        {info?.glb && !made && (
          <div className="i3d__live">
            <div className="i3d__text">
              <strong>
                <Check size={15} aria-hidden /> No cardápio
              </strong>
              <span className="cm-hint">Modelo publicado · {mb(info.glb.size)}</span>
            </div>
            <div className="i3d__live-actions">
              <Button variant="ghost" size="sm" onClick={() => setShowLive((v) => !v)}>
                {showLive ? 'Esconder' : 'Ver'}
              </Button>
              {canWrite && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 size={15} />}
                  loading={busy === 'remove'}
                  disabled={working}
                  onClick={remove}
                >
                  Remover
                </Button>
              )}
            </div>
          </div>
        )}
        {showLive && info?.glb && !made && <Preview src={info.glb.url} name={itemName} />}

        {canWrite && (
          <section className="i3d__make">
            {error && <Alert tone="danger">{error}</Alert>}
            {made && glbUrl ? (
              <>
                <div className="i3d__result">
                  <Preview src={glbUrl} name={itemName} />
                  {shape && (
                    <div className="i3d__shape">
                      <p className="cm-hint">
                        {made.byAi ? 'A IA leu a forma assim' : 'Montado com esta forma'} ·{' '}
                        {String(made.size.widthCm).replace('.', ',')} cm de largura ·{' '}
                        {mb(made.bytes)}. Ficou estranho? Ajuste e monte de novo (não gasta IA).
                      </p>
                      <label className="cm-field">
                        <span className="cm-label">Forma</span>
                        <select
                          className="cm-input"
                          value={shape.kind}
                          onChange={(e) => {
                            const k = e.target.value as DishKind;
                            setShape((s) =>
                              s
                                ? {
                                    ...s,
                                    kind: k,
                                    view: tall(k) && s.view !== 'top' ? 'side' : s.view,
                                    profile: null,
                                  }
                                : s,
                            );
                          }}
                        >
                          {KINDS.map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="cm-field">
                        <span className="cm-label">De onde a foto foi tirada</span>
                        <select
                          className="cm-input"
                          value={shape.view}
                          onChange={(e) => edit('view', e.target.value as DishShape['view'])}
                        >
                          {VIEWS.map(([v, label]) => (
                            <option key={v} value={v}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="i3d__nums">
                        <label className="cm-field">
                          <span className="cm-label">Largura (cm)</span>
                          <input
                            className="cm-input"
                            type="number"
                            inputMode="decimal"
                            min={3}
                            max={60}
                            value={shape.diameterCm}
                            onChange={(e) => edit('diameterCm', Number(e.target.value) || 3)}
                          />
                        </label>
                        <label className="cm-field">
                          <span className="cm-label">
                            {tall(shape.kind) ? 'Altura (cm)' : 'Altura da comida (cm)'}
                          </span>
                          <input
                            className="cm-input"
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={45}
                            value={tall(shape.kind) ? shape.heightCm : shape.foodHeightCm}
                            onChange={(e) =>
                              edit(
                                tall(shape.kind) ? 'heightCm' : 'foodHeightCm',
                                Math.max(0, Number(e.target.value) || 0),
                              )
                            }
                          />
                        </label>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<RefreshCw size={15} />}
                        loading={busy === 'make'}
                        disabled={working}
                        onClick={() => void make(null, shape)}
                      >
                        Montar de novo
                      </Button>
                    </div>
                  )}
                </div>
                <div className="i3d__foot">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={working}
                    onClick={() => {
                      setMade(null);
                      setShape(null);
                      setError(null);
                    }}
                  >
                    Descartar
                  </Button>
                  <Button
                    size="sm"
                    icon={<Check size={15} />}
                    loading={busy === 'publish'}
                    disabled={working}
                    onClick={publish}
                  >
                    {info?.glb ? 'Trocar o do cardápio' : 'Publicar no cardápio'}
                  </Button>
                </div>
              </>
            ) : (
              <div className="i3d__start">
                <div className="i3d__photo" aria-hidden>
                  {photoUrl || imageId ? (
                    <img src={photoUrl ?? `/api/v1/media/${imageId}`} alt="" draggable={false} />
                  ) : (
                    <ImageIcon size={22} />
                  )}
                </div>
                <div className="i3d__start-text">
                  <strong>{info?.glb ? 'Fazer outro pela foto' : 'Fazer o 3D pela foto'}</strong>
                  <span className="cm-hint">
                    {aiReady
                      ? 'Foto do prato inteiro, de lado (45°) ou de cima, sem cortar a borda. Desconta um pouco dos tokens de IA.'
                      : `${ai?.reason ? `${ai.reason}. ` : ''}Dá para montar escolhendo a forma do prato depois.`}
                  </span>
                  <div className="i3d__start-actions">
                    {imageId && (
                      <Button
                        size="sm"
                        icon={<Wand2 size={15} />}
                        loading={busy === 'make'}
                        disabled={working}
                        onClick={() => void make(imageId)}
                      >
                        Usar a foto do item
                      </Button>
                    )}
                    <input
                      ref={camera}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) void make(f);
                      }}
                    />
                    <Button
                      variant={imageId ? 'secondary' : 'primary'}
                      size="sm"
                      icon={<Camera size={15} />}
                      disabled={working}
                      onClick={() => camera.current?.click()}
                    >
                      Tirar ou escolher foto
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        <details className="i3d__files">
          <summary>Já tem o arquivo 3D? Enviar .glb ou .usdz</summary>
          <div className="i3d__files-body">
            {fileRow('glb', 'Modelo (.glb)', 'Funciona em qualquer celular.')}
            {fileRow(
              'usdz',
              'iPhone (.usdz)',
              'Opcional. Sem ele, o iPhone gera na hora a partir do .glb (demora um pouco mais).',
            )}
          </div>
        </details>
      </div>
    </Card>
  );
}
