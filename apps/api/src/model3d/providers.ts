/**
 * Quem cria o 3D a partir das fotos do prato. Duas opções, escolhidas no ambiente do servidor:
 *
 * - `local`: gerador de IA rodando na nossa própria VM (ou numa máquina com placa de vídeo da
 *   rede interna), no contêiner de infrastructure/model3d-ai (TripoSR, código aberto). Não manda
 *   foto para fora e não tem custo por modelo; precisa de memória (8 GB livres) e é lento sem GPU.
 * - `meshy`: serviço de mercado (meshy.ai) pela API, com a chave do Comandou. Rápido e com
 *   textura melhor; custa créditos por modelo e as fotos vão para lá.
 *
 * Os dois devolvem um GLB bruto: quem chama passa ele pelo optimizeModel antes de guardar.
 */

export interface GenerateImage {
  type: string;
  bytes: Buffer;
}
export interface GenerateResult {
  /** GLB bruto, na escala que o gerador quiser (o otimizador acerta o tamanho). */
  glb: Buffer;
}
export type Progress = (percent: number) => Promise<void> | void;

export interface Model3dProvider {
  readonly name: 'local' | 'meshy';
  generate(images: GenerateImage[], progress: Progress): Promise<GenerateResult>;
}

/** Erro que o restaurante pode ler (vai para a tela); os outros viram uma mensagem genérica. */
export class GenerateError extends Error {}

/** Maior arquivo que aceitamos baixar de um gerador (o otimizador reduz depois). */
const MAX_DOWNLOAD = 150 * 1024 * 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function download(url: string, signal?: AbortSignal): Promise<Buffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const size = Number(res.headers.get('content-length') ?? 0);
  if (size > MAX_DOWNLOAD) throw new GenerateError('O gerador devolveu um modelo grande demais');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD)
    throw new GenerateError('O gerador devolveu um modelo grande demais');
  return buf;
}

const dataUri = (i: GenerateImage) => `data:${i.type};base64,${i.bytes.toString('base64')}`;

/** Gerador na nossa VM: POST /generate com as fotos, responde o GLB. */
export class LocalProvider implements Model3dProvider {
  readonly name = 'local' as const;
  constructor(
    private readonly url: string,
    private readonly token?: string,
    private readonly timeoutMs = 20 * 60_000,
  ) {}

  async generate(images: GenerateImage[], progress: Progress): Promise<GenerateResult> {
    await progress(5);
    let res: Response;
    try {
      res = await fetch(`${this.url.replace(/\/$/, '')}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'model/gltf-binary',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({
          images: images.map((i) => ({ type: i.type, data: i.bytes.toString('base64') })),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new Error(`gerador local fora do ar: ${(e as Error).message}`);
    }
    if (res.status === 422) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new GenerateError(body.message ?? 'O gerador não conseguiu usar essa foto');
    }
    if (!res.ok) throw new Error(`gerador local respondeu ${res.status}`);
    const glb = Buffer.from(await res.arrayBuffer());
    await progress(85);
    return { glb };
  }
}

interface MeshyTask {
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'EXPIRED';
  progress?: number;
  model_urls?: { glb?: string };
  task_error?: { message?: string };
}

/**
 * Meshy (https://docs.meshy.ai): "Image to 3D" com uma foto, "Multi-Image to 3D" com 2 a 4
 * (frente, lado, trás...). A foto vai como data URI; o resultado vem por consulta.
 */
export class MeshyProvider implements Model3dProvider {
  readonly name = 'meshy' as const;
  constructor(
    private readonly key: string,
    private readonly baseUrl = 'https://api.meshy.ai',
    private readonly pollMs = 5_000,
    private readonly timeoutMs = 20 * 60_000,
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (res.status === 402)
      throw new GenerateError('Acabaram os créditos de 3D do Comandou. Avise o suporte.');
    if (res.status === 400 || res.status === 422)
      throw new GenerateError(`O gerador recusou a foto: ${body.message ?? res.status}`);
    if (!res.ok) throw new Error(`meshy ${res.status}: ${body.message ?? ''}`.trim());
    return body;
  }

  async generate(images: GenerateImage[], progress: Progress): Promise<GenerateResult> {
    const multi = images.length > 1;
    const path = multi ? '/openapi/v1/multi-image-to-3d' : '/openapi/v1/image-to-3d';
    const common = {
      should_texture: true,
      enable_pbr: false,
      should_remesh: true,
      topology: 'triangle',
      target_polycount: 60_000,
    };
    const { result: id } = await this.call<{ result: string }>(path, {
      method: 'POST',
      body: JSON.stringify(
        multi
          ? { ...common, image_urls: images.map(dataUri) }
          : { ...common, image_url: dataUri(images[0]!) },
      ),
    });
    if (!id) throw new Error('meshy não devolveu o id da tarefa');
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const t = await this.call<MeshyTask>(`${path}/${encodeURIComponent(id)}`);
      if (t.status === 'SUCCEEDED') {
        if (!t.model_urls?.glb) throw new Error('meshy terminou sem GLB');
        await progress(85);
        // O USDZ do Meshy não serve: viria em outra escala. O iPhone gera o dele a partir do GLB.
        return { glb: await download(t.model_urls.glb) };
      }
      if (t.status === 'FAILED' || t.status === 'CANCELED' || t.status === 'EXPIRED')
        throw new GenerateError(
          `O gerador não conseguiu criar o 3D${t.task_error?.message ? `: ${t.task_error.message}` : ''}`,
        );
      // A etapa do gerador vai de 5 a 80 na nossa barra; o resto é baixar e otimizar.
      await progress(5 + Math.round(((t.progress ?? 0) / 100) * 75));
      if (Date.now() > deadline) throw new Error('meshy demorou demais');
      await sleep(this.pollMs);
    }
  }
}

export interface ProviderEnv {
  MODEL3D_PROVIDER: 'auto' | 'local' | 'meshy' | 'off';
  MODEL3D_LOCAL_URL?: string;
  MODEL3D_LOCAL_TOKEN?: string;
  MESHY_API_KEY?: string;
  MESHY_API_URL: string;
}

/** O gerador configurado no servidor; null = gerar por foto desligado (enviar arquivo continua). */
export function providerFrom(env: ProviderEnv): Model3dProvider | null {
  const local = env.MODEL3D_LOCAL_URL
    ? new LocalProvider(env.MODEL3D_LOCAL_URL, env.MODEL3D_LOCAL_TOKEN)
    : null;
  const meshy = env.MESHY_API_KEY ? new MeshyProvider(env.MESHY_API_KEY, env.MESHY_API_URL) : null;
  switch (env.MODEL3D_PROVIDER) {
    case 'off':
      return null;
    case 'local':
      return local;
    case 'meshy':
      return meshy;
    default:
      return local ?? meshy;
  }
}
