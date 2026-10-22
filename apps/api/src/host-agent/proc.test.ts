import { describe, expect, it } from 'vitest';
import { demuxLogs } from './docker';
import { cpuCount, cpuPercent, parseCpu, parseLoad, parseMeminfo, parseNetDev } from './proc';

describe('Leitura do servidor', () => {
  it('CPU: uso e steal entre duas leituras', () => {
    const a = parseCpu('cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 1\ncpu1 1\n');
    const b = parseCpu('cpu  150 0 150 880 0 0 0 20 0 0\n');
    expect(cpuPercent(a, b)).toEqual({ busy: 60, steal: 10 });
    expect(cpuCount('cpu  1\ncpu0 1\ncpu1 1\n')).toBe(2);
  });

  it('memória usada = total − disponível', () => {
    const m = parseMeminfo(
      'MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 600 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n',
    );
    expect(m).toMatchObject({ total: 1024000, available: 614400, used: 409600, swapUsed: 0 });
  });

  it('rede ignora lo e interfaces do Docker', () => {
    const text = `Inter-|   Receive
 face |bytes    packets errs drop fifo frame compressed multicast|bytes
    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0
  ens3: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0
docker0: 5 1 0 0 0 0 0 0 5 1 0 0 0 0 0 0
veth12: 5 1 0 0 0 0 0 0 5 1 0 0 0 0 0 0`;
    expect(parseNetDev(text)).toEqual({ rx: 1000, tx: 2000 });
    expect(parseLoad('0.16 0.26 0.32 1/293 1234\n')).toEqual([0.16, 0.26, 0.32]);
  });

  it('logs do Docker: separa os quadros de stdout/stderr', () => {
    const frame = (stream: number, text: string) => {
      const body = Buffer.from(text);
      const head = Buffer.alloc(8);
      head[0] = stream;
      head.writeUInt32BE(body.length, 4);
      return Buffer.concat([head, body]);
    };
    expect(demuxLogs(Buffer.concat([frame(1, 'ok\n'), frame(2, 'erro\n')]))).toBe('ok\nerro\n');
    expect(demuxLogs(Buffer.from('texto puro'))).toBe('texto puro');
  });
});
