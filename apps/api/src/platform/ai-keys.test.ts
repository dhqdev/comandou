import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { seal } from '../common/secret-box';
import { CLIENT_KEY_CONTEXT, OWNER_KEY_CONTEXT, siteKey, systemKey } from './ai-keys';

const SECRET = randomBytes(32).toString('base64');
const clients = seal(SECRET, 'sk-or-restaurantes', CLIENT_KEY_CONTEXT);
const owner = seal(SECRET, 'sk-or-dono', OWNER_KEY_CONTEXT);

describe('chaves do OpenRouter', () => {
  it('os sites com IA usam a chave dos restaurantes, e a sua só se ela faltar', () => {
    expect(siteKey(SECRET, { api_key_enc: clients, owner_api_key_enc: owner })).toEqual({
      key: 'sk-or-restaurantes',
      kind: 'clients',
    });
    expect(siteKey(SECRET, { api_key_enc: null, owner_api_key_enc: owner })).toEqual({
      key: 'sk-or-dono',
      kind: 'owner',
    });
    expect(siteKey(SECRET, { api_key_enc: null, owner_api_key_enc: null })).toBeNull();
    // Chave salva com outra INTEGRATIONS_KEY não abre: cai para a próxima.
    const other = randomBytes(32).toString('base64');
    expect(siteKey(other, { api_key_enc: clients, owner_api_key_enc: null })).toBeNull();
  });

  it('o sistema continua preferindo a sua chave', () => {
    expect(systemKey(SECRET, { api_key_enc: clients, owner_api_key_enc: owner })?.kind).toBe(
      'owner',
    );
    expect(systemKey(SECRET, { api_key_enc: clients, owner_api_key_enc: null })?.kind).toBe(
      'clients',
    );
  });
});
