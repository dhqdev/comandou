/**
 * Regras de segurança usadas pela API e pelo app (mesma resposta dos dois lados).
 *
 * - Senha: tamanho mínimo e recusa das senhas que aparecem primeiro em qualquer lista de
 *   vazamento (ASVS 5.0, 6.2.4). Só vale para senha NOVA: quem já tem uma senha antiga
 *   continua entrando normalmente.
 * - Planilha (CSV): célula de texto que começa com = + - @ vira fórmula no Excel/Sheets
 *   ("injeção de fórmula", OWASP). Nome de produto vindo de importação ou do iFood não pode
 *   abrir link nem rodar fórmula na planilha do dono.
 */

/** Mínimo para cliente do cardápio e equipe do restaurante. */
export const PASSWORD_MIN = 8;

// Senhas mais comuns no Brasil e no mundo (listas públicas de vazamentos), já sem acento e em
// minúsculas. Sequências e repetições são pegas pela regra, não pela lista.
const COMMON = new Set([
  'password',
  'password1',
  'password123',
  'senha123',
  'senha1234',
  'senha12345',
  'senhasenha',
  'minhasenha',
  'mudar123',
  'trocar123',
  'admin123',
  'admin1234',
  'administrador',
  'qwerty123',
  'qwertyuiop',
  'asdfghjkl',
  'iloveyou',
  'brasil123',
  'flamengo',
  'flamengo1',
  'corinthians',
  'palmeiras',
  'saopaulo',
  'vasco123',
  'gremio123',
  'restaurante',
  'restaurante1',
  'restaurante123',
  'comandou',
  'comandou1',
  'comandou123',
  'cardapio',
  'cardapio123',
  'pizzaria',
  'pizzaria123',
  'lanchonete',
  'hamburguer',
  'mudar@123',
  'senha@123',
  'admin@123',
  'abc12345',
  'abcd1234',
  'a1b2c3d4',
  'q1w2e3r4',
  'q1w2e3r4t5',
  '1q2w3e4r',
  '1q2w3e4r5t',
  'zaq12wsx',
  'princesa',
  'jesus123',
  'deusefiel',
  'amor1234',
  'teamo123',
]);

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Todos os caracteres iguais ("aaaaaaaa") ou em sequência ("12345678", "abcdefgh", "87654321"). */
function isRun(s: string): boolean {
  if (new Set(s).size <= 2) return true;
  let up = true;
  let down = true;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (d !== 1) up = false;
    if (d !== -1) down = false;
  }
  return up || down;
}

/**
 * Motivo para recusar uma senha nova, ou null quando ela serve. `personal` são dados da pessoa
 * (e-mail, telefone, nome do restaurante) que não podem ser a senha.
 */
export function weakPasswordReason(
  password: string,
  personal: (string | null | undefined)[] = [],
  min = PASSWORD_MIN,
): string | null {
  if (password.length < min) return `A senha precisa de pelo menos ${min} caracteres`;
  const f = fold(password.trim());
  const bare = f.replace(/[^a-z0-9]/g, '');
  if (COMMON.has(f) || COMMON.has(bare) || isRun(f) || (bare.length >= 6 && isRun(bare)))
    return 'Essa senha é fácil de adivinhar. Escolha outra.';
  for (const p of personal) {
    if (!p) continue;
    const v = fold(p.trim());
    const local = v.includes('@') ? v.split('@')[0]! : v;
    const digits = v.replace(/\D/g, '');
    if (
      (local.length >= 4 && (f === local || bare === local.replace(/[^a-z0-9]/g, ''))) ||
      (digits.length >= 8 && bare.replace(/\D/g, '') === digits && /^\d+$/.test(bare))
    )
      return 'A senha não pode ser o seu e-mail, telefone ou nome.';
  }
  return null;
}

/** Célula de texto segura para CSV: entre aspas e sem virar fórmula. */
export function csvText(value: string | null | undefined): string {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
