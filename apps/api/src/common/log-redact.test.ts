import { describe, expect, it } from 'vitest';
import { maskSecretsInUrl } from './log-redact';

describe('maskSecretsInUrl', () => {
  it('esconde o token do rastreio público', () => {
    expect(maskSecretsInUrl('/api/v1/track/abcDEF123_-x?x=1')).toBe('/api/v1/track/[oculto]?x=1');
  });
  it('esconde o token na URL do provider do Traefik', () => {
    expect(maskSecretsInUrl('/api/v1/internal/traefik?token=abc123&x=1')).toBe(
      '/api/v1/internal/traefik?token=[oculto]&x=1',
    );
  });
  it('não mexe nas outras rotas', () => {
    expect(maskSecretsInUrl('/api/v1/orders/123')).toBe('/api/v1/orders/123');
    expect(maskSecretsInUrl(undefined)).toBeUndefined();
  });
});
