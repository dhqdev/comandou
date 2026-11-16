import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VmHelper } from './vm';

async function setup(installed = true) {
  const dir = await mkdtemp(join(tmpdir(), 'vm-'));
  await mkdir(join(dir, 'pedidos'));
  await mkdir(join(dir, 'jobs'));
  if (installed) await writeFile(join(dir, 'info.json'), JSON.stringify({ helperVersion: 1 }));
  return dir;
}

describe('ajudante da VM (pedidos para scripts/vm.sh)', () => {
  it('sem o ajudante instalado, recusa e diz como resolver', async () => {
    const vm = new VmHelper(await setup(false));
    expect((await vm.info()).installed).toBe(false);
    await expect(vm.request('reboot')).rejects.toThrow(/não está instalado/);
  });

  it('só aceita ações da lista e alvos de limpeza conhecidos', async () => {
    const dir = await setup();
    const vm = new VmHelper(dir);
    await expect(vm.request('rm -rf /')).rejects.toThrow(/desconhecida/);
    await expect(vm.request('clean', ['tudo'])).rejects.toThrow(/escolha/);
    const r = await vm.request('clean', ['apt', '; reboot', 'ram']);
    expect(r.targets).toEqual(['apt', 'ram']);
    const files = await readdir(join(dir, 'pedidos'));
    expect(files).toEqual([`${r.id}.req`]);
    expect(await readFile(join(dir, 'pedidos', files[0]!), 'utf8')).toBe('clean apt ram\n');
  });

  it('um de cada vez: com pedido na fila ou trabalho rodando, recusa outro', async () => {
    const dir = await setup();
    const vm = new VmHelper(dir);
    const first = await vm.request('check');
    await expect(vm.request('upgrade')).rejects.toThrow(/espere terminar/);
    const info = await vm.info();
    expect(info.jobs[0]).toMatchObject({ id: first.id, status: 'pending', action: 'check' });
    // O ajudante pegou o pedido e está rodando.
    await writeFile(join(dir, 'pedidos', `${first.id}.req`), '');
    await (await import('node:fs/promises')).rm(join(dir, 'pedidos', `${first.id}.req`));
    await writeFile(
      join(dir, 'jobs', `${first.id}.json`),
      JSON.stringify({
        id: first.id,
        action: 'check',
        status: 'running',
        startedAt: new Date().toISOString(),
      }),
    );
    await expect(vm.request('upgrade')).rejects.toThrow(/rodando/);
  });

  it('trabalho "rodando" há horas vira falha (a VM reiniciou no meio)', async () => {
    const dir = await setup();
    await writeFile(
      join(dir, 'jobs', 'aaaaaaaa-1.json'),
      JSON.stringify({
        id: 'aaaaaaaa-1',
        action: 'upgrade',
        status: 'running',
        startedAt: '2020-01-01T00:00:00Z',
      }),
    );
    await writeFile(join(dir, 'jobs', 'aaaaaaaa-1.log'), 'linha 1\n');
    const vm = new VmHelper(dir);
    expect((await vm.jobs())[0]!.status).toBe('failed');
    expect((await vm.job('aaaaaaaa-1')).log).toBe('linha 1\n');
    await expect(vm.job('../info')).rejects.toThrow(/inválido/);
    await vm.request('check'); // não está mais travado
  });

  it('pedido parado na fila por minutos marca o ajudante como travado', async () => {
    const dir = await setup();
    let now = Date.now();
    const vm = new VmHelper(dir, () => now);
    await vm.request('check');
    expect((await vm.info()).stuck).toBe(false);
    now += 10 * 60_000;
    expect((await vm.info()).stuck).toBe(true);
  });
});
