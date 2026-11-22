import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Updater } from './updater';

/** Docker de mentira: serviços em memória; cada update muda a imagem e conclui na hora. */
function fakeDocker(
  opts: {
    failOn?: string;
    missingImage?: string;
    migrateFails?: boolean;
    /** Serviço cuja troca fica em "updating" para sempre (as tarefas sobem ou não). */
    stuck?: { service: string; tasksUp: boolean; untilForce?: boolean };
    /** Estado do Swarm de cada serviço antes de qualquer troca. */
    state?: Record<string, string>;
  } = {},
) {
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
      if (method === 'GET' && path === '/services')
        return [...services.values()].map((s) => ({
          ...s,
          UpdateStatus: { State: opts.state?.[s.Spec.Name] ?? 'completed' },
        }));
      const sm = /^\/services\/([^/?]+)(\/update)?/.exec(path);
      if (sm && method === 'GET') {
        const key = [...services.keys()].find(
          (k) => k === decodeURIComponent(sm[1]!) || services.get(k).ID === sm[1],
        )!;
        const s = services.get(key);
        const stuck =
          opts.stuck?.service === s.Spec.Name &&
          !(opts.stuck?.untilForce && s.Spec.TaskTemplate.ForceUpdate);
        return {
          ...s,
          UpdateStatus: {
            State:
              opts.failOn === s.Spec.Name
                ? 'rollback_completed'
                : stuck
                  ? 'updating'
                  : (opts.state?.[s.Spec.Name] ?? 'completed'),
          },
        };
      }
      if (sm && method === 'POST') {
        const s = [...services.values()].find((x) => x.ID === sm[1])!;
        s.Spec = body;
        s.Version.Index++;
        return {};
      }
      if (path.startsWith('/tasks') && !path.includes('migrate')) {
        const name = JSON.parse(decodeURIComponent(path.split('filters=')[1]!)).service[0];
        const s = services.get(name);
        const up = opts.stuck?.service === name ? opts.stuck?.tasksUp : true;
        return [
          {
            DesiredState: 'running',
            Spec: { ContainerSpec: { Image: s.Spec.TaskTemplate.ContainerSpec.Image } },
            Status: { State: up ? 'running' : 'preparing' },
          },
        ];
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
const make = (f: ReturnType<typeof fakeDocker>, extra: Record<string, unknown> = {}) =>
  new Updater(f.docker as never, {
    sleep: async () => undefined,
    selfName: async () => 'comandou_comandou-agent',
    stateFile: null,
    ...extra,
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

  it('limpa só depois dos serviços saudáveis e antes de reiniciar o agente', async () => {
    const f = fakeDocker();
    const order: string[] = [];
    const u = new Updater(
      {
        call: async (m: string, p: string, b?: unknown) => {
          if (p.startsWith('/services/id-') && m === 'POST') order.push(p.split('/')[2]!);
          return f.docker.call(m, p, b);
        },
      } as never,
      {
        sleep: async () => undefined,
        selfName: async () => 'comandou_comandou-agent',
        stateFile: null,
        cleanup: async () => {
          order.push('limpeza');
          return [{ target: 'containers', reclaimed: 1, removed: 2 }];
        },
      },
    );
    await u.start('v0.11.0');
    const job = await finish(u);
    expect(job.status).toBe('done');
    expect(order).toEqual([
      'id-comandou_comandou-migrate',
      'id-comandou_comandou-api',
      'id-comandou_comandou-web',
      'limpeza',
      'id-comandou_comandou-agent',
    ]);
    expect(job.cleanup).toEqual([{ target: 'containers', reclaimed: 1, removed: 2 }]);
  });

  it('atualização que falha não limpa nada', async () => {
    const f = fakeDocker({ failOn: 'comandou_comandou-api' });
    let ran = false;
    const u = new Updater(f.docker as never, {
      sleep: async () => undefined,
      selfName: async () => 'comandou_comandou-agent',
      stateFile: null,
      cleanup: async () => {
        ran = true;
        return [];
      },
    });
    await u.start('v0.11.0');
    await finish(u);
    expect(ran).toBe(false);
  });
});

describe('Destravar a atualização', () => {
  // Relógio que anda 1 min a cada espera: o prazo de 5 min estoura em poucas voltas.
  const clock = () => {
    let t = 0;
    const real = Date.now;
    Date.now = () => real() + t;
    return {
      sleep: async () => {
        t += 60_000;
      },
      restore: () => (Date.now = real),
    };
  };

  it('troca que não marca "concluído" mas já está de pé na versão nova: segue em frente', async () => {
    const f = fakeDocker({ stuck: { service: 'comandou_comandou-api', tasksUp: true } });
    const c = clock();
    try {
      const u = make(f, { sleep: c.sleep });
      await u.start('v0.11.0');
      const job = await finish(u);
      expect(job.status).toBe('done');
      expect(job.steps.map((s) => s.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    } finally {
      c.restore();
    }
  });

  it('troca parada no meio: reinicia o serviço sozinho uma vez (como no Portainer) e continua', async () => {
    const f = fakeDocker({
      stuck: { service: 'comandou_comandou-api', tasksUp: false, untilForce: true },
    });
    const c = clock();
    try {
      const u = make(f, { sleep: c.sleep });
      await u.start('v0.11.0');
      const job = await finish(u);
      expect(job.status).toBe('done');
      expect(f.services.get('comandou_comandou-api').Spec.TaskTemplate.ForceUpdate).toBe(1);
      const apiPosts = f.calls.filter((x) =>
        x.startsWith('POST /services/id-comandou_comandou-api'),
      );
      expect(apiPosts).toHaveLength(2);
    } finally {
      c.restore();
    }
  });

  it('nem o reinício resolve: para com a explicação e não mexe nos que faltam', async () => {
    const f = fakeDocker({ stuck: { service: 'comandou_comandou-api', tasksUp: false } });
    const c = clock();
    try {
      const u = make(f, { sleep: c.sleep });
      await u.start('v0.11.0');
      const job = await finish(u);
      expect(job.status).toBe('failed');
      expect(job.message).toMatch(/nem depois de reiniciar/);
      expect(job.steps.map((s) => s.status)).toEqual(['ok', 'failed', 'skipped', 'skipped']);
    } finally {
      c.restore();
    }
  });

  it('Destravar e continuar: larga a parada e refaz só o que ficou no meio e o que falta', async () => {
    const f = fakeDocker({ stuck: { service: 'comandou_comandou-api', tasksUp: false } });
    let resumed = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // A troca da API "trava": a espera só volta quando a gente soltar.
    const u: Updater = make(f, {
      sleep: async () => {
        if (!resumed && u.current()?.steps[1]?.status === 'running') await gate;
      },
    });
    await u.start('v0.11.0');
    for (let i = 0; i < 50 && u.current()!.steps[1]!.status !== 'running'; i++)
      await new Promise((r) => setTimeout(r, 1));
    const first = u.current()!;
    expect(first.steps[1]).toMatchObject({ status: 'running' });
    expect(first.steps[1]!.startedAt).toBeTruthy();

    // No Swarm, a API já tem a tag nova escrita, mas a troca ficou "updating".
    const real = f.docker.call;
    let stuck = true;
    f.docker.call = async (m: string, p: string, b?: any) => {
      if (m === 'GET' && p === '/services')
        return [...f.services.values()].map((s) => ({
          ...s,
          UpdateStatus: {
            State: stuck && s.Spec.Name === 'comandou_comandou-api' ? 'updating' : 'completed',
          },
        }));
      if (m === 'POST' && p.startsWith('/services/id-comandou_comandou-api')) stuck = false;
      if (m === 'GET' && p.startsWith('/services/id-comandou_comandou-api') && !stuck)
        return {
          ...f.services.get('comandou_comandou-api'),
          UpdateStatus: { State: 'completed' },
        };
      return real(m, p, b);
    };
    const before = f.calls.length;
    resumed = true;
    const job = await u.resume();
    expect(job).not.toBe(first);
    expect(first.status).toBe('failed');
    expect(first.message).toMatch(/destravar/);
    expect(job.steps.map((s) => [s.service, s.status])).toEqual([
      ['comandou_comandou-migrate', 'skipped'],
      ['comandou_comandou-api', 'pending'],
      ['comandou_comandou-web', 'pending'],
      ['comandou_comandou-agent', 'pending'],
    ]);
    const done = await finish(u);
    expect(done.status).toBe('done');
    // A API foi refeita com reinício forçado (a imagem já era a nova).
    expect(f.services.get('comandou_comandou-api').Spec.TaskTemplate.ForceUpdate).toBe(1);
    // O laço antigo, solto agora, para sem mexer em mais nada.
    release();
    await new Promise((r) => setTimeout(r, 10));
    const posts = f.calls.slice(before).filter((x) => x.startsWith('POST'));
    expect(posts).toHaveLength(3);
  });

  it('o andamento sobrevive ao reinício do agente e vira "interrompida", pronta para continuar', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'upd-')), 'atualizacao.json');
    const f = fakeDocker({ migrateFails: true });
    const u = make(f, { stateFile: file });
    await u.start('v0.11.0');
    await finish(u);
    expect(JSON.parse(readFileSync(file, 'utf8')).status).toBe('failed');

    // Agente caiu com a API trocando.
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    saved.status = 'running';
    saved.steps[0].status = 'ok';
    saved.steps[1].status = 'running';
    saved.steps[2].status = 'pending';
    writeFileSync(file, JSON.stringify(saved));
    const again = make(fakeDocker(), { stateFile: file }).current()!;
    expect(again.status).toBe('failed');
    expect(again.message).toMatch(/reiniciou no meio/);
    expect(again.steps.map((s) => s.status)).toEqual(['ok', 'skipped', 'skipped', 'skipped']);
  });

  it('o próprio agente é o último: o arquivo já diz "concluída" antes de ele reiniciar', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'upd-')), 'atualizacao.json');
    const u = make(fakeDocker(), { stateFile: file });
    await u.start('v0.11.0');
    await finish(u);
    const next = make(fakeDocker(), { stateFile: file }).current()!;
    expect(next.status).toBe('done');
  });

  it('continuar quando tudo já terminou: fecha como concluída', async () => {
    const f = fakeDocker();
    const u = make(f);
    await u.start('v0.11.0');
    await finish(u);
    const job = await u.resume();
    expect(job.status).toBe('done');
  });
});

describe('registryAuthFromEnv', () => {
  it('monta o login do GHCR só com usuário e token', async () => {
    const { registryAuthFromEnv } = await import('./updater');
    expect(registryAuthFromEnv('ghcr.io/dhqdev/comandou-', {})).toBeNull();
    const a = registryAuthFromEnv('ghcr.io/dhqdev/comandou-', {
      AGENT_REGISTRY_USER: 'dhqdev',
      AGENT_REGISTRY_TOKEN: 'ghp_x',
    })!;
    expect(JSON.parse(Buffer.from(a, 'base64url').toString())).toEqual({
      username: 'dhqdev',
      password: 'ghp_x',
      serveraddress: 'ghcr.io',
    });
  });
});
