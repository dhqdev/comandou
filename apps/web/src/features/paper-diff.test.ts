import { describe, expect, it } from 'vitest';
import { changedLines } from './paper-diff';

describe('linhas que mudaram no papel', () => {
  it('pisca só a linha nova, mesmo com as de baixo descendo', () => {
    expect(changedLines('a\nb\nc', 'a\nnova\nb\nc')).toEqual([1]);
  });

  it('linha trocada pisca; linha tirada não deixa nada piscando', () => {
    expect(changedLines('a\nTOTAL 10\nc', 'a\n@@G@@TOTAL 10\nc')).toEqual([1]);
    expect(changedLines('a\nb\nc', 'a\nc')).toEqual([]);
  });

  it('papel igual não pisca; papel novo inteiro pisca todo', () => {
    expect(changedLines('a\nb', 'a\nb')).toEqual([]);
    expect(changedLines('', 'x\ny')).toEqual([0, 1]);
  });
});
