import { describe, expect, it } from 'vitest';
import { Components, productOf, splitImage, versionsFromImage } from './components';

const stack = (s: string) => ({ 'com.docker.stack.namespace': s });
const svc = (name: string, image: string, labels: Record<string, string>) => ({
  ID: name,
  Version: { Index: 7 },
  Spec: { Name: name, Labels: labels, TaskTemplate: { ContainerSpec: { Image: image } } },
});

describe('componentes da VM e versões', () => {
  it('lê nome, tag e digest da imagem', () => {
    expect(splitImage('postgres:16-alpine@sha256:abc')).toEqual({
      repo: 'postgres',
      tag: '16-alpine',
      digest: 'sha256:abc',
    });
    expect(splitImage('localhost:5000/x')).toEqual({
      repo: 'localhost:5000/x',
      tag: 'latest',
      digest: null,
    });
    expect(productOf('ghcr.io/dhqdev/comandou-web')).toBe('Comandou Web');
    expect(productOf('edoburu/pgbouncer')).toBe('PgBouncer');
  });

  it('versão real de dentro da imagem', () => {
    const pg = versionsFromImage('PostgreSQL', '16-alpine', {
      Config: { Env: ['PG_MAJOR=16', 'PG_VERSION=16.6', 'PATH=/usr/bin'] },
    });
    expect(pg).toEqual({ version: '16.6', runtimes: [] });
    const web = versionsFromImage('Comandou Web', 'v0.129.0', {
      Config: { Env: ['NGINX_VERSION=1.29.1'] },
    });
    expect(web).toEqual({ version: 'v0.129.0', runtimes: [{ name: 'Nginx', version: '1.29.1' }] });
    const traefik = versionsFromImage('Traefik', 'v3.6', {
      Config: { Labels: { 'org.opencontainers.image.version': 'v3.6.2' } },
    });
    expect(traefik.version).toBe('v3.6.2');
  });

  it('compilação nova da mesma tag; só atualiza terceiros das nossas stacks', async () => {
    const services = [
      svc('comandou_api', 'ghcr.io/dhqdev/comandou-api:v1.0.0@sha256:a1', stack('comandou')),
      svc('comandou_postgres', 'postgres:16-alpine@sha256:old', stack('comandou')),
      svc('comandou_redis', 'redis:7.4-alpine@sha256:same', stack('comandou')),
      svc('outra_n8n', 'n8nio/n8n:1@sha256:x', stack('outra')),
    ];
    const updates: {
      path: string;
      body: { TaskTemplate: { ContainerSpec: { Image: string } } };
    }[] = [];
    const docker = {
      call: async (method: string, path: string, body?: unknown) => {
        if (path === '/services') return services;
        if (path.startsWith('/services/') && method === 'GET')
          return services.find((s) => s.ID === decodeURIComponent(path.split('/')[2]!));
        if (path.startsWith('/services/') && method === 'POST') {
          updates.push({ path, body: body as never });
          return {};
        }
        if (path.startsWith('/images/')) return { Config: { Env: ['PG_VERSION=16.4'] } };
        if (path === '/distribution/postgres:16-alpine/json')
          return { Descriptor: { digest: 'sha256:new' } };
        if (path === '/distribution/redis:7.4-alpine/json')
          return { Descriptor: { digest: 'sha256:same' } };
        if (path.startsWith('/distribution/')) throw new Error('sem acesso');
        if (path === '/version')
          return { Version: '29.1', Components: [{ Name: 'containerd', Version: '2.4' }] };
        throw new Error(path);
      },
    };
    const c = new Components(docker as never, async () => 'comandou');
    const r = await c.list();
    const by = Object.fromEntries(r.components.map((x) => [x.service, x]));
    expect(r.components[0]!.service).toBe('comandou_api');
    expect(by.comandou_api!.update.status).toBe('managed');
    expect(by.comandou_postgres!.update.status).toBe('available');
    expect(by.comandou_redis!.update.status).toBe('current');
    expect(by.outra_n8n!.canUpdate).toBe(false);
    expect(r.engine?.components).toEqual([{ name: 'containerd', version: '2.4' }]);

    await expect(c.update('comandou_api')).rejects.toThrow(/Atualizar sistema/);
    await expect(c.update('outra_n8n')).rejects.toThrow(/fora das stacks/);
    await expect(c.update('comandou_redis')).rejects.toThrow(/mais nova/);
    await c.update('comandou_postgres');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.path).toBe('/services/comandou_postgres/update?version=7');
    expect(updates[0]!.body.TaskTemplate.ContainerSpec.Image).toBe('postgres:16-alpine@sha256:new');
  });
});
