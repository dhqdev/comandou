import { describe, expect, it } from 'vitest';
import { classifyHost } from './host';

const BASE = 'comandou.com';

describe('classifyHost', () => {
  it('extrai o slug de <slug>.comandou.com, com porta e maiúsculas', () => {
    expect(classifyHost('MaoRefato.Comandou.com:443', BASE)).toEqual({
      kind: 'tenant-subdomain',
      slug: 'maorefato',
      hostname: 'maorefato.comandou.com',
    });
  });
  it('reconhece o domínio da plataforma', () => {
    expect(classifyHost('comandou.com', BASE).kind).toBe('platform');
    expect(classifyHost('www.comandou.com', BASE).kind).toBe('platform');
  });
  it('reconhece o painel Super Admin em admin.<base>, separado dos restaurantes', () => {
    expect(classifyHost('Admin.Comandou.com', BASE)).toEqual({
      kind: 'platform-admin',
      hostname: 'admin.comandou.com',
    });
    expect(classifyHost('admin.evil.com', BASE).kind).toBe('custom-domain');
  });
  it('trata outros hosts como domínio personalizado (validado no banco)', () => {
    expect(classifyHost('pedidos.restaurante.com.br', BASE)).toEqual({
      kind: 'custom-domain',
      hostname: 'pedidos.restaurante.com.br',
    });
  });
  it('rejeita hosts malformados e tentativas de injeção', () => {
    for (const h of [
      undefined,
      '',
      'a.b.comandou.com',
      'api.comandou.com',
      'evil.com,maorefato.comandou.com',
      'user@maorefato.comandou.com',
      'maorefato.comandou.com/x',
      'mao refato.comandou.com',
      'x..comandou.com',
      '-bad.comandou.com',
    ]) {
      expect(classifyHost(h, BASE).kind, String(h)).toBe('invalid');
    }
  });
});
