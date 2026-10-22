import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  newTotpSecret,
  otpauthUri,
  totpCode,
  verifyTotp,
} from './totp';

// Vetores do RFC 6238 (apêndice B), SHA-1, segredo ASCII "12345678901234567890", 8 dígitos.
// Aqui usamos 6 dígitos: os 6 últimos dígitos dos valores de 8 do RFC.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('base32 ida e volta', () => {
    const b = Buffer.from('PedeMais-123!');
    expect(base32Decode(base32Encode(b))).toEqual(b);
    expect(base32Encode(Buffer.from('12345678901234567890'))).toBe(
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    );
  });

  it('confere com os vetores do RFC 6238', () => {
    expect(totpCode(RFC_SECRET, Math.floor(59 / 30))).toBe('287082'); // 94287082
    expect(totpCode(RFC_SECRET, Math.floor(1111111109 / 30))).toBe('081804'); // 07081804
    expect(totpCode(RFC_SECRET, Math.floor(1234567890 / 30))).toBe('005924'); // 89005924
    expect(totpCode(RFC_SECRET, Math.floor(2000000000 / 30))).toBe('279037'); // 69279037
  });

  it('aceita ±1 passo e recusa o resto', () => {
    const s = newTotpSecret();
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30000);
    expect(verifyTotp(s, totpCode(s, step), now)).toBe(step);
    expect(verifyTotp(s, totpCode(s, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(s, totpCode(s, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(s, totpCode(s, step - 2), now)).toBeNull();
    expect(verifyTotp(s, '12345', now)).toBeNull();
    expect(verifyTotp(s, 'abcdef', now)).toBeNull();
  });

  it('gera o endereço otpauth para o aplicativo autenticador', () => {
    expect(otpauthUri('ABC', 'ana@x.com')).toBe(
      'otpauth://totp/PedeMais%20Admin%3Aana%40x.com?secret=ABC&issuer=PedeMais%20Admin&algorithm=SHA1&digits=6&period=30',
    );
  });
});
