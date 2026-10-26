import { describe, expect, it } from 'vitest';
import { statusEvent } from './orders.service';

describe('statusEvent', () => {
  it('escolhe o aviso certo para cada passo', () => {
    expect(statusEvent('awaiting', 'new', 'delivery')).toBe('order.accepted');
    expect(statusEvent('in_production', 'ready', 'pickup')).toBe('order.ready');
    expect(statusEvent('ready', 'dispatched', 'delivery')).toBe('order.dispatched');
    expect(statusEvent('dispatched', 'completed', 'delivery')).toBe('order.delivered');
    expect(statusEvent('awaiting', 'cancelled', 'pickup')).toBe('order.cancelled');
  });
  it('não avisa salão nem passos internos', () => {
    expect(statusEvent('in_production', 'ready', 'table')).toBeNull();
    expect(statusEvent('new', 'in_production', 'delivery')).toBeNull();
    expect(statusEvent('new', 'cancelled', 'table')).toBeNull();
    expect(statusEvent('ready', 'completed', 'pickup')).toBeNull();
  });
});
