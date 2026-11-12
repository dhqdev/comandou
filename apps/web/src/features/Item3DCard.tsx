import { Box, Camera, ExternalLink, Eye, ImagePlus, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, TextField, useToast } from '../design-system';
import { api, ApiError } from '../lib/api';
import { mediaUrl, uploadImage } from '../lib/media';
import { Model3DViewer } from '../pages/public/Model3D';
import { MODEL3D_TOOLS } from './model3d-tools';
import './item-3d.css';

interface ModelFile {
  size: number;
  url: string;
}
interface Job {
  id: string;
  kind: 'generate' | 'optimize';
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: number;
  error: string | null;
  stats: { sizeCm?: [number, number, number]; inputBytes?: number; outputBytes?: number } | null;
}
interface Studio {
  optimize: boolean;
  generate: boolean;
  provider: 'local' | 'meshy' | null;
  used: number;
  limit: number;
}
interface ModelInfo {
  glb: ModelFile | null;
  usdz: ModelFile | null;
  job?: Job | null;
  studio?: Studio;
}

const MAX_SOURCE = 40 * 1024 * 1024;
const MAX_USDZ = 12 * 1024 * 1024;
const MAX_PHOTOS = 4;
const mb = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
const active = (j: Job | null | undefined) => j?.status === 'queued' || j?.status === 'running';

async function sendFile(path: string, type: string, file: File): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': type, 'X-Comandou-Request': '1', Accept: 'application/json' },
      body: file,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor');
  }
  const body = (await res.json().catch(() => undefined)) as { message?: string } | undefined;
  if (!res.ok) throw new ApiError(res.status, body?.message ?? `Erro ${res.status}`);
  return body;
}

function jobLabel(j: Job) {
  if (j.status === 'queued') return 'Na fila do servidor…';
  return j.kind === 'generate'
    ? j.progress >= 85
      ? 'Deixando o modelo leve para o celular…'
      : 'Criando o 3D pelas fotos. Leva de 1 a 5 minutos…'
    : 'Otimizando o arquivo: reduzindo a malha e as texturas…';
}

/**
 * Item em 3D. O servidor do Comandou cria o modelo pelas fotos do prato (IA) ou recebe o arquivo
 * escaneado no celular e deixa ele leve. No cardápio aparece "Ver em 3D" e o cliente vê o prato
 * na mesa dele pela câmera.
 */
export function Item3DCard({
  productId,
  canWrite,
  name,
  imageId,
}: {
  productId: string;
  canWrite: boolean;
  name: string;
  imageId: string | null;
}) {
  const toast = useToast();
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [busy, setBusy] = useState<'generate' | 'source' | 'usdz' | 'photo' | 'remove' | null>(
    null,
  );
  const [useItemPhoto, setUseItemPhoto] = useState(true);
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [sizeCm, setSizeCm] = useState('25');
  const [viewing, setViewing] = useState(false);
  const sourceInput = useRef<HTMLInputElement>(null);
  const usdzInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const lastJob = useRef<string | null>(null);

  const load = useCallback(
    () =>
      api<ModelInfo>(`/products/${productId}/model`).then(
        (m) => {
          setInfo(m);
          return m;
        },
        () => {
          setInfo((i) => i ?? { glb: null, usdz: null });
          return null;
        },
      ),
    [productId],
  );

  useEffect(() => {
    void load().then((m) => (lastJob.current = active(m?.job) ? m!.job!.id : null));
  }, [load]);

  // Acompanha o trabalho em andamento e avisa quando termina.
  const job = info?.job ?? null;
  useEffect(() => {
    if (!active(job)) return;
    lastJob.current = job!.id;
    const t = setTimeout(() => {
      void load().then((m) => {
        const j = m?.job;
        if (!j || j.id !== lastJob.current || active(j)) return;
        lastJob.current = null;
        if (j.status === 'done') {
          toast('Modelo 3D pronto. Já aparece no cardápio.', 'success');
          setPhotos([]);
        } else toast(j.error ?? 'Não deu para criar o modelo', 'danger');
      });
    }, 2500);
    return () => clearTimeout(t);
  }, [job, load, toast]);

  const studio = info?.studio;
  const running = active(job);
  const itemPhoto = useItemPhoto && imageId ? [imageId] : [];
  const chosen = [...itemPhoto, ...photos.map((p) => p.id)].slice(0, MAX_PHOTOS);
  const left = studio ? Math.max(0, studio.limit - studio.used) : 0;
  const size = Number(sizeCm);
  const sizeOk = sizeCm === '' || (Number.isInteger(size) && size >= 3 && size <= 200);

  async function act<T>(kind: NonNullable<typeof busy>, fn: () => Promise<T>) {
    setBusy(kind);
    try {
      return await fn();
    } catch (e) {
      toast((e as Error).message, 'danger');
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function addPhotos(files: FileList | null) {
    const list = Array.from(files ?? []).slice(0, MAX_PHOTOS - chosen.length);
    if (!list.length) return;
    await act('photo', async () => {
      for (const f of list) {
        const up = await uploadImage(f);
        setPhotos((p) => [...p, up]);
      }
    });
  }

  async function generate() {
    const j = await act('generate', () =>
      api<Job>(`/products/${productId}/model/generate`, {
        method: 'POST',
        json: { mediaIds: chosen, sizeCm: sizeCm ? size : null },
      }),
    );
    if (j) await load();
  }

  async function sendSource(file: File | undefined) {
    if (!file) return;
    const n = file.name.toLowerCase();
    if (!n.endsWith('.glb') && !n.endsWith('.zip'))
      return toast('Escolha o arquivo .glb ou o .zip com o .gltf', 'danger');
    if (file.size > MAX_SOURCE)
      return toast(
        `O arquivo tem ${mb(file.size)}. O limite é 40 MB: exporte com menos detalhe.`,
        'danger',
      );
    const q = sizeCm && sizeOk ? `?sizeCm=${size}` : '';
    const ok = await act('source', () =>
      sendFile(
        `/products/${productId}/model/source${q}`,
        n.endsWith('.zip') ? 'application/zip' : 'application/vnd.comandou.model-source',
        file,
      ),
    );
    if (ok) await load();
  }

  async function sendUsdz(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.usdz'))
      return toast('Escolha um arquivo .usdz', 'danger');
    if (file.size > MAX_USDZ) return toast('O arquivo do iPhone pode ter até 12 MB', 'danger');
    const m = await act('usdz', () =>
      sendFile(`/products/${productId}/model/usdz`, 'model/vnd.usdz+zip', file),
    );
    if (m) {
      setInfo((i) => ({ ...(i ?? {}), ...(m as ModelInfo) }));
      toast('Arquivo do iPhone enviado', 'success');
    }
  }

  async function remove() {
    const m = await act('remove', () =>
      api<ModelInfo>(`/products/${productId}/model`, { method: 'DELETE' }),
    );
    if (m) {
      setInfo((i) => ({ ...i, ...m }));
      toast('Modelo 3D removido', 'success');
    }
  }

  const dims = job?.status === 'done' ? job.stats?.sizeCm : undefined;

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
          O cliente toca em “Ver em 3D” no cardápio, gira o prato e vê ele em tamanho real em cima
          da mesa pela câmera do celular. Crie o modelo aqui pelas fotos ou envie o arquivo
          escaneado: o servidor deixa ele leve para abrir rápido.
        </p>

        <div className="i3d__row">
          <div className="i3d__text">
            <strong>{info?.glb ? 'Publicado no cardápio' : 'Sem modelo 3D'}</strong>
            <span className="cm-hint">
              {info?.glb
                ? `${mb(info.glb.size)}${dims ? ` · ${Math.round(Math.max(...dims))} cm` : ''}${info.usdz ? ' · com arquivo do iPhone' : ''}`
                : 'Crie pelas fotos ou envie o arquivo abaixo.'}
            </span>
          </div>
          {info?.glb && (
            <div className="i3d__actions">
              <Button
                variant="secondary"
                size="sm"
                icon={<Eye size={15} />}
                onClick={() => setViewing(true)}
              >
                Ver
              </Button>
              {canWrite && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 size={15} />}
                  loading={busy === 'remove'}
                  disabled={busy !== null || running}
                  onClick={remove}
                >
                  Remover
                </Button>
              )}
            </div>
          )}
        </div>

        {job && running && (
          <div className="i3d__job" role="status">
            <div className="i3d__job-text">
              <span className="cm-spinner" aria-hidden />
              <span>{jobLabel(job)}</span>
              <span className="i3d__pct">{job.progress}%</span>
            </div>
            <div className="i3d__bar" aria-hidden>
              <span style={{ transform: `scaleX(${Math.max(0.03, job.progress / 100)})` }} />
            </div>
            <span className="cm-hint">
              Pode sair desta tela: o servidor continua e o cardápio atualiza sozinho.
            </span>
          </div>
        )}
        {job?.status === 'failed' && (
          <Alert tone="warning">{job.error ?? 'Não deu para criar o modelo.'}</Alert>
        )}

        {canWrite && info && (
          <>
            <h3 className="i3d__section">Criar pelas fotos do prato</h3>
            {studio?.generate ? (
              <div className="i3d__gen">
                <p className="cm-hint i3d__lead">
                  Use a foto do item ou mande até 4 fotos de ângulos diferentes (frente, lado,
                  cima), com o prato inteiro aparecendo e fundo limpo. A IA cria o 3D e o servidor
                  ajusta o tamanho real.
                </p>
                <div className="i3d__photos">
                  {imageId && useItemPhoto && (
                    <figure className="i3d__photo">
                      <img src={mediaUrl(imageId)!} alt="Foto do item" />
                      <button
                        type="button"
                        aria-label="Não usar a foto do item"
                        onClick={() => setUseItemPhoto(false)}
                      >
                        <X size={14} />
                      </button>
                    </figure>
                  )}
                  {photos.map((p) => (
                    <figure className="i3d__photo" key={p.id}>
                      <img src={p.url} alt="Foto para o 3D" />
                      <button
                        type="button"
                        aria-label="Tirar esta foto"
                        onClick={() => setPhotos((l) => l.filter((x) => x.id !== p.id))}
                      >
                        <X size={14} />
                      </button>
                    </figure>
                  ))}
                  {chosen.length < MAX_PHOTOS && (
                    <button
                      type="button"
                      className="i3d__add"
                      disabled={busy !== null}
                      onClick={() => photoInput.current?.click()}
                    >
                      {busy === 'photo' ? (
                        <span className="cm-spinner" aria-hidden />
                      ) : (
                        <ImagePlus size={18} aria-hidden />
                      )}
                      <span>{chosen.length ? 'Outro ângulo' : 'Adicionar foto'}</span>
                    </button>
                  )}
                  {imageId && !useItemPhoto && (
                    <Button variant="ghost" size="sm" onClick={() => setUseItemPhoto(true)}>
                      Usar a foto do item
                    </Button>
                  )}
                </div>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    void addPhotos(e.target.files);
                    e.target.value = '';
                  }}
                />
                <div className="i3d__gen-foot">
                  <TextField
                    label="Tamanho real do prato (cm)"
                    inputMode="numeric"
                    wrapClass="i3d__size"
                    value={sizeCm}
                    error={sizeOk ? undefined : 'Entre 3 e 200 cm'}
                    hint="A maior medida: largura do prato, altura do copo."
                    onChange={(e) => setSizeCm(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  />
                  <div className="i3d__gen-go">
                    <Button
                      variant="secondary"
                      icon={<Camera size={16} />}
                      loading={busy === 'generate'}
                      disabled={!chosen.length || !sizeOk || running || busy !== null || left === 0}
                      onClick={generate}
                    >
                      Criar em 3D
                    </Button>
                    <span className="cm-hint">
                      {left === 0
                        ? `Os ${studio.limit} do mês já foram usados.`
                        : `${left} de ${studio.limit} restantes este mês.`}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="cm-hint i3d__lead">
                Criar o 3D por foto ainda não está ligado neste servidor. Envie o arquivo escaneado
                abaixo ou use um dos sites da lista.
              </p>
            )}

            <h3 className="i3d__section">Enviar o arquivo escaneado</h3>
            <div className="i3d__row">
              <div className="i3d__text">
                <strong>Modelo do aplicativo (.glb ou .zip)</strong>
                <span className="cm-hint">
                  Até 40 MB, do jeito que o aplicativo exportou. O servidor reduz para abrir rápido
                  no celular.
                </span>
              </div>
              <input
                ref={sourceInput}
                type="file"
                accept=".glb,.zip,model/gltf-binary,application/zip"
                hidden
                onChange={(e) => {
                  void sendSource(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<Upload size={15} />}
                loading={busy === 'source'}
                disabled={busy !== null || running}
                onClick={() => sourceInput.current?.click()}
              >
                Enviar arquivo
              </Button>
            </div>
            <div className="i3d__row">
              <div className="i3d__text">
                <strong>iPhone (.usdz)</strong>
                <span className="cm-hint">
                  {info.usdz
                    ? `Enviado · ${mb(info.usdz.size)}`
                    : 'Opcional. Sem ele, o iPhone monta o dele a partir do modelo.'}
                </span>
              </div>
              <input
                ref={usdzInput}
                type="file"
                accept=".usdz,model/vnd.usdz+zip"
                hidden
                onChange={(e) => {
                  void sendUsdz(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                icon={<Upload size={15} />}
                loading={busy === 'usdz'}
                disabled={busy !== null || running || !info.glb}
                onClick={() => usdzInput.current?.click()}
              >
                {info.usdz ? 'Trocar' : 'Enviar .usdz'}
              </Button>
            </div>
          </>
        )}

        <details className="i3d__tools">
          <summary>Aplicativos e sites para criar o 3D</summary>
          {MODEL3D_TOOLS.map((g) => (
            <section key={g.title} className="i3d__tool-group">
              <h4>{g.title}</h4>
              <p className="cm-hint">{g.hint}</p>
              <ul>
                {g.tools.map((t) => (
                  <li key={t.name}>
                    <a href={t.url} target="_blank" rel="noreferrer noopener">
                      {t.name} <ExternalLink size={12} aria-hidden />
                    </a>
                    <span className="cm-hint">{t.what}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </details>
      </div>
      {viewing && info?.glb && (
        <Model3DViewer
          model={{ glb: info.glb.url, usdz: info.usdz?.url ?? null }}
          name={name || 'Item'}
          poster={null}
          onClose={() => setViewing(false)}
        />
      )}
    </Card>
  );
}
