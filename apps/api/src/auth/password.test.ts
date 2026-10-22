import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, DUMMY_HASH } from './password';

describe('password', () => {
  it('gera hash com salt e verifica', async () => {
    const h1 = await hashPassword('s3nh@-forte');
    const h2 = await hashPassword('s3nh@-forte');
    expect(h1).not.toEqual(h2);
    expect(await verifyPassword('s3nh@-forte', h1)).toBe(true);
    expect(await verifyPassword('errada', h1)).toBe(false);
  });
  it('rejeita formatos desconhecidos e o hash fictício', async () => {
    expect(await verifyPassword('x', 'bcrypt$abc')).toBe(false);
    expect(await verifyPassword('x', DUMMY_HASH)).toBe(false);
  });
});
