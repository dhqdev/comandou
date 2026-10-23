import { describe, expect, it } from 'vitest';
import { HostAgent, isOurs } from './agent';
import type { DockerClient } from './docker';

const label = (stack: string) => ({ 'com.docker.stack.namespace': stack });

describe('só a stack do Comandou na tela Servidor', () => {
  it('pela stack do agente; sem ela, pelo nome ou imagem', () => {
    const traefik = { name: 'traefik_traefik', image: 'traefik:2.11', labels: label('traefik') };
    const api = {
      name: 'comandou_api',
      image: 'ghcr.io/dhqdev/comandou-api:v1',
      labels: label('comandou'),
    };
    const db = { name: 'comandou_comandou-db', image: 'postgres:16', labels: label('comandou') };
    expect([traefik, api, db].filter((x) => isOurs('comandou', x)).map((x) => x.name)).toEqual([
      'comandou_api',
      'comandou_comandou-db',
    ]);
    expect(isOurs(null, traefik)).toBe(false);
    expect(isOurs(null, { name: 'x_api', image: 'ghcr.io/dhqdev/comandou-api:v1' })).toBe(true);
  });

  it('lista, logs e reinício só dos serviços da nossa stack', async () => {
    const service = (name: string, stack: string, image: string) => ({
      ID: name,
      Version: { Index: 1 },
      UpdatedAt: '',
      Spec: {
        Name: name,
        Labels: label(stack),
        Mode: { Replicated: { Replicas: 1 } },
        TaskTemplate: { ContainerSpec: { Image: image } },
      },
    });
    const services = [
      service('comandou_api', 'comandou', 'ghcr.io/dhqdev/comandou-api:v1'),
      service('portainer_agent', 'portainer', 'portainer/agent'),
    ];
    const calls: string[] = [];
    const docker = {
      call: async (method: string, path: string) => {
        calls.push(`${method} ${path}`);
        if (path === '/info') return { ServerVersion: '27', Swarm: { LocalNodeState: 'active' } };
        if (path.startsWith('/containers/json'))
          return [
            {
              Id: 'a'.repeat(64),
              Names: ['/comandou_api.1'],
              Image: 'ghcr.io/dhqdev/comandou-api:v1',
              State: 'running',
              Status: 'Up',
              Created: 0,
              Labels: { ...label('comandou'), 'com.docker.swarm.service.name': 'comandou_api' },
            },
            {
              Id: 'b'.repeat(64),
              Names: ['/n8n'],
              Image: 'n8nio/n8n',
              State: 'running',
              Status: 'Up',
              Created: 0,
              Labels: {},
            },
          ];
        if (path === '/services') return services;
        if (path === '/tasks') return [];
        const m = /^\/services\/([^/?]+)/.exec(path);
        if (m) return services.find((s) => s.Spec.Name === decodeURIComponent(m[1]!));
        throw new Error(`inesperado: ${path}`);
      },
    } as unknown as DockerClient;
    const agent = new HostAgent(undefined, docker, 10, 'comandou');
    const st = await (
      agent as unknown as {
        dockerStatus(): Promise<{
          stack: string;
          services: { name: string }[];
          containers: { list: { name: string }[] };
        }>;
      }
    ).dockerStatus();
    expect(st.stack).toBe('comandou');
    expect(st.services.map((s) => s.name)).toEqual(['comandou_api']);
    expect(st.containers.list.map((c) => c.name)).toEqual(['comandou_api.1']);
    await expect(agent.serviceLogs('portainer_agent', 50)).rejects.toThrow(/fora da stack/);
    await expect(agent.restartService('portainer_agent')).rejects.toThrow(/fora da stack/);
    expect(calls.some((c) => c.includes('/services/portainer_agent/logs'))).toBe(false);
  });
});
