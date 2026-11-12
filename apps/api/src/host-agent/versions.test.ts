import { describe, expect, it } from 'vitest';
import { Updater } from './updater';
import { PINNED_LABEL, PinnedVersions, pinnedEnv, pinnedLabels } from './versions';

const P = 'ghcr.io/dhqdev/comandou-';

/** Docker de mentira: serviços em memória; tarefas sempre rodando. */
function fakeDocker() {
  const services: any[] = [];
  let n = 0;
  const add = (name: string, image: string, labels: Record<string, string> = {}, env?: string[]) =>
    services.push({
      ID: `id-${++n}`,
      Version: { Index: 1 },
      Spec: {
        Name: name,
        Labels: { 'com.docker.stack.namespace': 'comandou', ...labels },
        Mode: { Replicated: { Replicas: 2 } },
        TaskTemplate: {
          ContainerSpec: { Image: image, Env: env },
          Networks: [{ Target: 'net1', Aliases: ['api'] }],
        },
        UpdateConfig: { Order: 'start-first' },
      },
    });
  add(
    'comandou_api',
    `${P}api:v0.110.0@sha256:abc`,
    {
      'traefik.enable': 'true',
      'traefik.http.services.comandou-api.loadbalancer.server.port': '3000',
      'traefik.http.services.comandou-api.loadbalancer.healthcheck.path': '/api/v1/health/ready',
      'traefik.http.routers.comandou-api.rule': 'HostRegexp(`x`)',
    },
    ['NODE_ENV=production', 'BILLING_INTERVAL_MINUTES=30'],
  );
  add('comandou_web', `${P}web:v0.110.0`, {
    'traefik.http.services.comandou-web.loadbalancer.server.port': '8080',
  });
  add('comandou_migrate', `${P}api:v0.110.0`);
  add('comandou_agent', `${P}api:v0.110.0`);
  const calls: string[] = [];
  const docker = {
    async call(method: string, path: string, body?: any) {
      calls.push(`${method} ${path.split('?')[0]}`);
      if (path.startsWith('/distribution/')) return {};
      if (method === 'GET' && path === '/services') return structuredClone(services);
      if (method === 'POST' && path === '/services/create') {
        services.push({ ID: `id-${++n}`, Version: { Index: 1 }, Spec: body });
        return {};
      }
      if (method === 'DELETE') {
        const i = services.findIndex((s) => `/services/${s.ID}` === path);
        services.splice(i, 1);
        return {};
      }
      if (path.startsWith('/tasks')) return [{ Status: { State: 'running' } }];
      throw new Error(`não esperado: ${method} ${path}`);
    },
  };
  return { docker: docker as any, services, calls };
}

describe('versões anteriores lado a lado', () => {
  it('rótulos: serviço do Traefik com o nome da versão, sem roteadores nem stack', () => {
    const l = pinnedLabels(
      {
        'com.docker.stack.namespace': 'comandou',
        'traefik.enable': 'true',
        'traefik.http.services.comandou-api.loadbalancer.server.port': '3000',
        'traefik.http.routers.comandou-api.rule': 'x',
        'traefik.http.middlewares.m.plugin': 'y',
      },
      'v0.108.5',
    );
    expect(l).toEqual({
      'traefik.enable': 'true',
      'traefik.http.services.comandou-api-v0-108-5.loadbalancer.server.port': '3000',
      [PINNED_LABEL]: 'v0.108.5',
    });
  });

  it('variáveis: fila própria e rotinas de fundo desligadas', () => {
    const env = pinnedEnv(['QUEUE_PREFIX=cm', 'BILLING_INTERVAL_MINUTES=30', 'X=1'], 'v0.108.5');
    expect(env).toContain('QUEUE_PREFIX=cm-v0-108-5');
    expect(env).toContain('BILLING_INTERVAL_MINUTES=0');
    expect(env).toContain('MAINTENANCE_INTERVAL_MINUTES=0');
    expect(env).toContain('TENANT_UPDATE_INTERVAL_SECONDS=0');
    expect(env).toContain('X=1');
  });

  it('ensure cria a api e a web da versão, 1 réplica, sem apelido de rede; remove tira as duas', async () => {
    const { docker, services } = fakeDocker();
    const pv = new PinnedVersions(docker, { prefix: P, registryAuth: null, sleep: async () => {} });
    const r = await pv.ensure('v0.110.0');
    expect(r).toMatchObject({ version: 'v0.110.0', ready: true });
    const api = services.find((s) => s.Spec.Name === 'comandou_api-v0-110-0')!;
    expect(api.Spec.TaskTemplate.ContainerSpec.Image).toBe(`${P}api:v0.110.0`);
    expect(api.Spec.Mode).toEqual({ Replicated: { Replicas: 1 } });
    expect(api.Spec.TaskTemplate.Networks).toEqual([{ Target: 'net1' }]);
    expect(api.Spec.Labels['com.docker.stack.namespace']).toBeUndefined();
    expect(api.Spec.TaskTemplate.ContainerSpec.Env).toContain('QUEUE_PREFIX=comandou-v0-110-0');
    expect(services.find((s) => s.Spec.Name === 'comandou_web-v0-110-0')).toBeTruthy();
    // Segunda chamada não duplica.
    await pv.ensure('v0.110.0');
    expect(services.filter((s) => s.Spec.Labels?.[PINNED_LABEL]).length).toBe(2);
    expect((await pv.list()).map((v) => v.version)).toEqual(['v0.110.0']);

    // A atualização geral não mexe nas cópias.
    const up = new Updater(docker, { prefix: P, registryAuth: null, selfName: async () => null });
    const plan = await up.plan('v0.111.0');
    expect(plan.map((s) => s.service).sort()).toEqual([
      'comandou_agent',
      'comandou_api',
      'comandou_migrate',
      'comandou_web',
    ]);

    expect((await pv.remove('v0.110.0')).removed.sort()).toEqual([
      'comandou_api-v0-110-0',
      'comandou_web-v0-110-0',
    ]);
    expect(services.length).toBe(4);
  });

  it('versão inválida é recusada', async () => {
    const { docker } = fakeDocker();
    const pv = new PinnedVersions(docker, { prefix: P, registryAuth: null });
    await expect(pv.ensure('latest')).rejects.toThrow('versão inválida');
  });
});
