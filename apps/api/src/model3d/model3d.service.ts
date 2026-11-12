import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { one, q } from '../common/sql';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { redisConnection } from '../queue/queue.service';
import { ModelInputError, optimizeModel } from './optimize';
import { GenerateError, Model3dProvider, providerFrom } from './providers';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Tamanho de um prato comum, quando a IA cria o modelo e ninguém informou a medida. */
const DEFAULT_GENERATED_CM = 25;

interface JobData {
  tenantId: string;
  jobId: string;
}
interface JobRow {
  product_id: string;
  kind: 'generate' | 'optimize';
  size_cm: number | null;
}

/**
 * Trabalhos do estúdio 3D. Ficam numa fila própria ("model3d"), separada da fila geral: um
 * modelo pesado leva memória e minutos, e não pode atrasar aviso de pedido nem nota fiscal.
 * Em produção quem consome é o serviço model3d (um por vez, com memória própria). Sem Redis
 * (desenvolvimento, testes), roda neste processo, um de cada vez.
 */
@Injectable()
export class Model3dService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Model3d');
  readonly provider: Model3dProvider | null;
  private queue?: Queue;
  private worker?: Worker;
  /** Sem Redis: corrente de trabalhos deste processo (um de cada vez). */
  private inline: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
  ) {
    this.provider = providerFrom(env);
    if (env.REDIS_URL)
      this.queue = new Queue('model3d', {
        connection: redisConnection(env.REDIS_URL),
        prefix: env.QUEUE_PREFIX,
        defaultJobOptions: { removeOnComplete: 200, removeOnFail: 500 },
      });
  }

  /** Põe o trabalho na fila (chame depois do COMMIT que criou o registro). */
  async enqueue(tenantId: string, jobId: string) {
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(jobId)) throw new Error('trabalho 3D inválido');
    if (this.queue) {
      // Uma tentativa a mais só para queda do processo; o próprio trabalho marca a falha.
      await this.queue.add('model3d', { tenantId, jobId }, { jobId, attempts: 2 });
      return;
    }
    this.inline = this.inline.then(() =>
      this.closed ? undefined : this.run(tenantId, jobId).catch(() => undefined),
    );
  }

  /** Espera os trabalhos deste processo (testes, sem Redis). */
  idle() {
    return this.inline;
  }

  onApplicationBootstrap() {
    if (!this.queue || !this.env.MODEL3D_WORKER) return;
    this.worker = new Worker(
      'model3d',
      async (job: Job<JobData>) => {
        const { tenantId, jobId } = job.data ?? ({} as JobData);
        if (!UUID_RE.test(tenantId) || !UUID_RE.test(jobId))
          throw new Error('trabalho 3D inválido');
        await this.run(tenantId, jobId);
      },
      {
        connection: redisConnection(this.env.REDIS_URL!),
        prefix: this.env.QUEUE_PREFIX,
        concurrency: 1,
        // Gerar pela IA leva minutos: o trabalho só é dado como travado depois de 2 minutos sem sinal.
        lockDuration: 120_000,
      },
    );
    this.worker.on('failed', (job, err) => this.logger.warn(`${job?.id} falhou: ${err.message}`));
    this.logger.log(`consumindo a fila model3d (gerador: ${this.provider?.name ?? 'nenhum'})`);
  }

  async onModuleDestroy() {
    this.closed = true;
    await this.worker?.close();
    await this.queue?.close();
  }

  private progress(tenantId: string, jobId: string, p: number) {
    return this.db
      .withTenant({ tenantId }, (tx) =>
        q(tx, `UPDATE product_model_jobs SET progress = greatest(progress, $2) WHERE id = $1`, [
          jobId,
          Math.max(0, Math.min(99, Math.round(p))),
        ]),
      )
      .then(() => undefined);
  }

  /** Faz o trabalho e grava o resultado. Nunca deixa o registro "rodando" para sempre. */
  async run(tenantId: string, jobId: string): Promise<void> {
    const job = await this.db.withTenant({ tenantId }, (tx) =>
      one<JobRow>(
        tx,
        `UPDATE product_model_jobs SET status = 'running', started_at = now(), progress = 1
          WHERE id = $1 AND status IN ('queued', 'running')
          RETURNING product_id, kind, size_cm`,
        [jobId],
      ),
    );
    if (!job) return; // já terminou (fila repetida) ou o produto foi apagado
    try {
      const files = await this.db.withTenant({ tenantId }, (tx) =>
        q<{ content_type: string; bytes: Buffer }>(
          tx,
          `SELECT content_type, bytes FROM product_model_job_files WHERE job_id = $1 ORDER BY position`,
          [jobId],
        ),
      );
      if (!files.length) throw new ModelInputError('O arquivo enviado não foi encontrado');
      let raw: Buffer;
      let provider: string;
      let sizeCm = job.size_cm;
      if (job.kind === 'generate') {
        if (!this.provider)
          throw new GenerateError('Criar 3D por foto não está ligado neste servidor');
        provider = this.provider.name;
        raw = (
          await this.provider.generate(
            files.map((f) => ({ type: f.content_type, bytes: f.bytes })),
            (p) => this.progress(tenantId, jobId, p),
          )
        ).glb;
        sizeCm ??= DEFAULT_GENERATED_CM;
      } else {
        provider = 'studio';
        raw = files[0]!.bytes;
        await this.progress(tenantId, jobId, 20);
      }
      const { glb, stats } = await optimizeModel(raw, { sizeCm });
      await this.db.withTenant({ tenantId }, async (tx) => {
        // O USDZ antigo era de outro modelo: sai, e o iPhone gera o dele a partir do GLB novo.
        await q(
          tx,
          `INSERT INTO product_models (tenant_id, product_id, glb, usdz, created_by)
           SELECT $1, $2, $3, NULL, created_by FROM product_model_jobs WHERE id = $4
           ON CONFLICT (product_id) DO UPDATE SET glb = EXCLUDED.glb, usdz = NULL, updated_at = now()`,
          [tenantId, job.product_id, glb, jobId],
        );
        await q(
          tx,
          `UPDATE product_model_jobs SET status = 'done', progress = 100, provider = $2,
                  stats = $3, finished_at = now() WHERE id = $1`,
          [jobId, provider, JSON.stringify(stats)],
        );
        await q(tx, `DELETE FROM product_model_job_files WHERE job_id = $1`, [jobId]);
      });
      this.logger.log(
        `modelo pronto (${job.kind}, ${provider}): ${stats.inputBytes} → ${stats.outputBytes} bytes`,
      );
    } catch (e) {
      const readable = e instanceof ModelInputError || e instanceof GenerateError;
      if (!readable) this.logger.error(`trabalho ${jobId}: ${(e as Error).stack ?? e}`);
      const message = readable
        ? (e as Error).message
        : 'Não deu para processar o modelo agora. Tente de novo em alguns minutos.';
      await this.db.withTenant({ tenantId }, async (tx) => {
        await q(
          tx,
          `UPDATE product_model_jobs SET status = 'failed', error = left($2, 500), finished_at = now()
            WHERE id = $1`,
          [jobId, message],
        );
        await q(tx, `DELETE FROM product_model_job_files WHERE job_id = $1`, [jobId]);
      });
    }
  }
}
