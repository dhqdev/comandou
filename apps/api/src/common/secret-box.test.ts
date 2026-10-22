import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { open, seal } from './secret-box';

const key = randomBytes(32).toString('base64');

describe('secret-box', () => {
  it('cifra e decifra no mesmo contexto', () => {
    const s = seal(key, 'token-secreto', 'tenant-a');
    expect(s.toString('utf8')).not.toContain('token-secreto');
    expect(open(key, s, 'tenant-a')).toBe('token-secreto');
  });
  it('não decifra em outro contexto nem com outra chave', () => {
    const s = seal(key, 'token-secreto', 'tenant-a');
    expect(() => open(key, s, 'tenant-b')).toThrow();
    expect(() => open(randomBytes(32).toString('base64'), s, 'tenant-a')).toThrow();
  });
});
