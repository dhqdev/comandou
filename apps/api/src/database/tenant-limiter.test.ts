import { describe, expect, it } from 'vitest';
import { TenantBusy, TenantLimiter } from './tenant-limiter';

const A = 'tenant-a';
const B = 'tenant-b';

function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
}

describe('TenantLimiter', () => {
  it('um restaurante cheio não bloqueia o outro', async () => {
    const l = new TenantLimiter(2, 1000);
    const g = gate();
    const busy = [l.run(A, () => g.p), l.run(A, () => g.p)];
    expect(l.active(A)).toBe(2);
    // B entra na hora, mesmo com A no limite.
    await expect(l.run(B, async () => 'ok')).resolves.toBe('ok');
    g.open();
    await Promise.all(busy);
    expect(l.active(A)).toBe(0);
  });

  it('o excesso espera a vez e roda quando uma vaga abre', async () => {
    const l = new TenantLimiter(1, 1000);
    const g = gate();
    const order: string[] = [];
    const first = l.run(A, async () => {
      await g.p;
      order.push('1');
    });
    const second = l.run(A, async () => {
      order.push('2');
    });
    await Promise.resolve();
    expect(order).toEqual([]);
    g.open();
    await Promise.all([first, second]);
    expect(order).toEqual(['1', '2']);
  });

  it('desiste com 503 se a fila não andar a tempo', async () => {
    const l = new TenantLimiter(1, 20);
    const g = gate();
    const first = l.run(A, () => g.p);
    await expect(l.run(A, async () => 'x')).rejects.toBeInstanceOf(TenantBusy);
    g.open();
    await first;
    // A vaga volta normalmente depois do tempo esgotado.
    await expect(l.run(A, async () => 'y')).resolves.toBe('y');
  });

  it('chamada aninhada do mesmo restaurante não pega outra vaga (sem travar)', async () => {
    const l = new TenantLimiter(1, 50);
    const r = await l.run(A, () => l.run(A, async () => 'dentro'));
    expect(r).toBe('dentro');
  });

  it('erro dentro da transação devolve a vaga', async () => {
    const l = new TenantLimiter(1, 50);
    await expect(
      l.run(A, async () => {
        throw new Error('falhou');
      }),
    ).rejects.toThrow('falhou');
    expect(l.active(A)).toBe(0);
    await expect(l.run(A, async () => 'ok')).resolves.toBe('ok');
  });

  it('0 desliga o limite', async () => {
    const l = new TenantLimiter(0, 10);
    const g = gate();
    const many = Array.from({ length: 20 }, () => l.run(A, () => g.p));
    g.open();
    await Promise.all(many);
  });
});
