import { describe, expect, it } from 'vitest';
import { Updater } from './updater';

/** Docker de mentira: serviços em memória; cada update muda a imagem e conclui na hora. */
function fakeDocker(opts: { failOn?: string; missingImage?: string; migrateFails?: boolean } = {}) {
  const services = new Map<string, any>();
  const add = (name: string, image: string) =>
    services.set(name, {
      ID: `id-${name}`,
      Version: { Index: 1 },
      Spec: {
        Name: name,
        Mode: { Replicated: { Replicas: 1 } },
        TaskTemplate: { ContainerSpec: { Image: image } },
      },
    });
  const A = 'ghcr.io/dhqdev/comandou-api';
  add('comandou_comandou-api', `${A}:v0.10.0@sha256:abc`);
  add('comandou_comandou-migrate', `${A}:v0.10.0`);
  add('comandou_comandou-agent', `${A}:v0.10.0`);
  add('comandou_comandou-web', 'ghcr.io/dhqdev/comandou-web:v0.10.0');
  add('comandou_comandou-db', 'postgres:16-alpine');
  const calls: string[] = [];
  const docker = {
    async call(method: string, path: string, body?: any) {
      calls.push(`${method} ${path}`);
      if (path.startsWith('/distribution/')) {
        if (opts.missingImage && path.includes(opts.missingImage))
          throw new Error('manifest unknown');
        return {};
      }
      if (method === 'GET' && path === '/services') return [...services.values()];
      const sm = /^\/services\/([^/?]+)(\/update)?/.exec(path);
      if (sm && method === 'GET') {
        const key = [...services.keys()].find(
          (k) => k === decodeURIComponent(sm[1]!) || services.get(k).ID === sm[1],
        )!;
        const s = services.get(key);
        return {
          ...s,
          UpdateStatus: { State: opts.failOn === s.Spec.Name ? 'rollback_completed' : 'completed' },
        };
      }
      if (sm && method === 'POST') {
        const s = [...services.values()].find((x) => x.ID === sm[1])!;
        s.Spec = body;
        s.Version.Index++;
        return {};
      }
      if (path.startsWith('/tasks')) {
        const image = services.get('comandou_comandou-migrate').Spec.TaskTemplate.ContainerSpec
          .Image;
        return [
          {
            CreatedAt: '2026',
            Spec: { ContainerSpec: { Image: image } },
            Status: { State: opts.migrateFails ? 'failed' : 'complete', Err: 'boom' },
          },
        ];
      }
      throw new Error(`inesperado ${method} ${path}`);
    },
  };
  return { docker, services, calls };
}
const make = (f: ReturnType<typeof fakeDocker>) =>
  new Updater(f.docker as never, {
    sleep: async () => undefined,
    selfName: async () => 'comandou_comandou-agent',
  });
const finish = async (u: Updater) => {
  for (let i = 0; i < 50 && u.current()?.status === 'running'; i++)
    await new Promise((r) => setTimeout(r, 1));
  return u.current()!;
};

describe('Atualização do sistema', () => {
  it('plano: só imagens do Comandou, migração primeiro, agente por último', async () => {
    const f = fakeDocker();
    const plan = await make(f).plan('v0.11.0');
    expect(plan.map((s) => s.service)).toEqual([
      'comandou_comandou-migrate',
      'comandou_comandou-api',
      'comandou_comandou-web',
      'comandou_comandou-agent',
    ]);
    expect(plan[1]).toMatchObject({
      from: 'v0.10.0',
      to: 'v0.11.0',
      image: 'ghcr.io/dhqdev/comandou-api:v0.11.0',
    });
  });

  it('recusa versão fora do formato (nada de imagem ou tag arbitrária)', async () => {
    const u = make(fakeDocker());
    for (const v of ['latest', '0.11.0', 'v1.2', 'v1.2.3;rm', '../x', 'v1.2.3-rc1'])
      await expect(u.start(v)).rejects.toThrow(/versão inválida/);
  });

  it('atualiza na ordem, mantém o repositório e liga o rollback do Swarm', async () => {
    const f = fakeDocker();
    const u = make(f);
    await u.start('v0.11.0');
    const job = await finish(u);
    expect(job.status).toBe('done');
    expect(job.steps.map((s) => s.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    const api = f.services.get('comandou_comandou-api');
    expect(api.Spec.TaskTemplate.ContainerSpec.Image).toBe('ghcr.io/dhqdev/comandou-api:v0.11.0');
    expect(api.Spec.UpdateConfig.FailureAction).toBe('rollback');
    expect(f.services.get('comandou_comandou-db').Spec.TaskTemplate.ContainerSpec.Image).toBe(
      'postgres:16-alpine',
    );
    const posts = f.calls.filter((c) => c.startsWith('POST')).map((c) => c.split('/')[2]);
    expect(posts).toEqual([
      'id-comandou_comandou-migrate',
      'id-comandou_comandou-api',
      'id-comandou_comandou-web',
      'id-comandou_comandou-agent',
    ]);
  });

  it('migração que falha para tudo: nenhum outro serviço é tocado', async () => {
    const f = fakeDocker({ migrateFails: true });
    const u = make(f);
    await u.start('v0.11.0');
    const job = await finish(u);
    expect(job.status).toBe('failed');
    expect(job.message).toMatch(/migração falhou/);
    expect(job.steps.slice(1).every((s) => s.status === 'skipped')).toBe(true);
    expect(f.services.get('comandou_comandou-api').Spec.TaskTemplate.ContainerSpec.Image).toContain(
      ':v0.10.0',
    );
  });

  it('serviço que volta por rollback interrompe a sequência', async () => {
    const f = fakeDocker({ failOn: 'comandou_comandou-api' });
    const u = make(f);
    await u.start('v0.11.0');
    const job = await finish(u);
    expect(job.status).toBe('failed');
    expect(job.steps.map((s) => s.status)).toEqual(['ok', 'failed', 'skipped', 'skipped']);
  });

  it('imagem inexistente no registro: aborta antes de mexer em qualquer serviço', async () => {
    const f = fakeDocker({ missingImage: 'comandou-web' });
    await expect(make(f).start('v0.11.0')).rejects.toThrow(/não está disponível/);
    expect(f.calls.some((c) => c.startsWith('POST'))).toBe(false);
  });

  it('já na versão pedida: avisa; e não roda duas atualizações juntas', async () => {
    const f = fakeDocker();
    const u = make(f);
    await expect(u.start('v0.10.0')).rejects.toThrow(/já está nesta versão/);
    await u.start('v0.11.0');
    await expect(u.start('v0.12.0')).rejects.toThrow(/em andamento/);
    await finish(u);
  });
});
