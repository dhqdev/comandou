import { describe, expect, it } from 'vitest';
import { classifyHost } from './host';

const BASE = 'pedemais.com';

describe('classifyHost', () => {
  it('extrai o slug de <slug>.pedemais.com, com porta e maiúsculas', () => {
    expect(classifyHost('MaoRefato.PedeMais.com:443', BASE)).toEqual({
      kind: 'tenant-subdomain',
      slug: 'maorefato',
      hostname: 'maorefato.pedemais.com',
    });
  });
  it('reconhece o domínio da plataforma', () => {
    expect(classifyHost('pedemais.com', BASE).kind).toBe('platform');
    expect(classifyHost('www.pedemais.com', BASE).kind).toBe('platform');
  });
  it('reconhece o painel Super Admin em admin.<base>, separado dos restaurantes', () => {
    expect(classifyHost('Admin.PedeMais.com', BASE)).toEqual({
      kind: 'platform-admin',
      hostname: 'admin.pedemais.com',
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
      'a.b.pedemais.com',
      'api.pedemais.com',
      'evil.com,maorefato.pedemais.com',
      'user@maorefato.pedemais.com',
      'maorefato.pedemais.com/x',
      'mao refato.pedemais.com',
      'x..pedemais.com',
      '-bad.pedemais.com',
    ]) {
      expect(classifyHost(h, BASE).kind, String(h)).toBe('invalid');
    }
  });
});
