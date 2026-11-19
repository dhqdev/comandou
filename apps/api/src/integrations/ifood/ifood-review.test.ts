import { describe, expect, it } from 'vitest';
import { firstName, ifoodReview, ifoodReviewPage, ifoodReviewSummary } from './ifood-review';

describe('avaliações do iFood', () => {
  it('traduz a avaliação com o primeiro nome, o pedido e a resposta da loja', () => {
    expect(
      ifoodReview({
        id: 'r1',
        score: '4.5',
        comment: 'Bom',
        customerName: 'Maria Cliente Silva',
        createdAt: '2026-11-18T20:00:00-03:00',
        status: 'replied',
        order: { id: 'pedido-1', shortId: '4821' },
        replies: [
          { text: 'Poderia melhorar', from: 'CUSTOMER', createdAt: '2026-11-18T23:10:00Z' },
          { text: 'Obrigado!', from: 'MERCHANT', createdAt: '2026-11-19T10:00:00Z' },
        ],
      }),
    ).toEqual({
      externalId: 'r1',
      score: 4.5,
      comment: 'Bom',
      customerName: 'Maria',
      status: 'REPLIED',
      createdAt: '2026-11-18T23:00:00.000Z',
      orderExternalId: 'pedido-1',
      orderCode: '4821',
      reply: { text: 'Obrigado!', at: '2026-11-19T10:00:00.000Z' },
      canReply: false,
    });
  });

  it('só aceita resposta em NOT_REPLIED sem resposta; sem id, nota ou data fica de fora', () => {
    const base = { id: 'r', score: 3, createdAt: '2026-11-18T20:00:00Z' };
    expect(ifoodReview({ ...base, status: 'NOT_REPLIED' })!.canReply).toBe(true);
    expect(ifoodReview({ ...base, status: 'CREATED' })!.canReply).toBe(false);
    expect(ifoodReview({ ...base, score: 7 })).toBeNull();
    expect(ifoodReview({ ...base, id: '' })).toBeNull();
    expect(ifoodReview({ ...base, createdAt: 'ontem' })).toBeNull();
    expect(firstName('  ana-luíza de souza')).toBe('ana-luíza');
    expect(firstName('***')).toBeUndefined();
  });

  it('página e resumo', () => {
    expect(
      ifoodReviewPage({
        reviews: [{ id: 'a', score: 5, createdAt: '2026-11-18T20:00:00Z' }, {}],
        pageCount: 2,
      }),
    ).toMatchObject({ pageCount: 2, reviews: [{ externalId: 'a' }] });
    expect(ifoodReviewPage(null)).toEqual({ reviews: [], pageCount: 1 });
    expect(ifoodReviewSummary({ score: 4.333, validReviewsCount: 12 })).toEqual({
      score: 4.33,
      count: 12,
    });
    expect(ifoodReviewSummary({})).toBeNull();
  });
});
