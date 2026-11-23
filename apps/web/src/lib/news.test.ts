import { describe, expect, it } from 'vitest';
import { markNewsSeen, newsExpiresAt, recentNews } from './news';

const at = (s: string) => new Date(s).getTime();

describe('novidades do sininho', () => {
  const list = [
    { version: '3', date: '2026-11-03' },
    { version: '2', date: '2026-11-01' },
    { version: '1', date: '2026-10-20' },
  ];

  it('mostra a versão no dia em que saiu e por mais 2 dias', () => {
    expect(recentNews(list, at('2026-11-03T09:00:00')).map((r) => r.version)).toEqual(['3', '2']);
    expect(recentNews(list, at('2026-11-05T23:59:00')).map((r) => r.version)).toEqual(['3']);
  });

  it('some sozinha depois dos 2 dias', () => {
    expect(newsExpiresAt({ date: '2026-11-03' })).toBe(at('2026-11-06T00:00:00'));
    expect(recentNews(list, at('2026-11-06T00:00:00'))).toEqual([]);
  });

  it('ignora data inválida', () => {
    expect(recentNews([{ date: 'x' }], at('2026-11-03T09:00:00'))).toEqual([]);
  });

  it('marca como lidas todas as novidades mostradas, mesmo em dia de muitas versões', () => {
    localStorage.setItem(
      'pm.newsSeen',
      JSON.stringify(Array.from({ length: 50 }, (_, i) => `old.${i}`)),
    );
    const shown = Array.from({ length: 70 }, (_, i) => `0.${300 - i}.0`);
    markNewsSeen(shown.slice(20));
    markNewsSeen(shown);
    const seen: string[] = JSON.parse(localStorage.getItem('pm.newsSeen') ?? '[]');
    expect(shown.filter((v) => !seen.includes(v))).toEqual([]);
  });
});
