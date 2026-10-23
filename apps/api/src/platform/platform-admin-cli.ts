import { resolveFileSecrets } from '../config/env';
import {
  PlatformAdminInput,
  bootstrapDefaultPlans,
  bootstrapPlatformAdmin,
  createPlatformAdmin,
  resetPlatformAdmin,
} from './platform-admin';
import { newTotpSecret, otpauthUri } from './totp';

/**
 * Administradores da plataforma (Super Admin). Só pela linha de comando, com a conexão do dono:
 * o painel não cria administradores. Segredos podem vir de arquivo (VAR_FILE).
 *
 *   --bootstrap          Usado pela stack a cada deploy. Cria os planos padrão (se não houver
 *                        nenhum plano) e o primeiro Super Admin a partir de
 *                        PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_NAME, PLATFORM_ADMIN_PASSWORD e
 *                        PLATFORM_ADMIN_TOTP_SECRET. Se já existe algum administrador, ou se
 *                        faltar variável, não faz nada (código 0). Nunca imprime segredos.
 *   <email> "<Nome>"     Cria mais um administrador. Imprime UMA vez o endereço otpauth://.
 *   --reset <email>      Troca a senha e o 2º fator (esqueci a senha) e encerra as sessões.
 *
 * Em todos: DATABASE_OWNER_URL e INTEGRATIONS_KEY. Fora do modo --bootstrap, a senha vem de
 * PLATFORM_ADMIN_PASSWORD e o segredo do autenticador (base32) de PLATFORM_ADMIN_TOTP_SECRET,
 * ou é gerado.
 */
async function main() {
  const env = resolveFileSecrets(process.env);
  const args = process.argv.slice(2);
  const ownerUrl = env.DATABASE_OWNER_URL;
  const key = env.INTEGRATIONS_KEY;
  const password = env.PLATFORM_ADMIN_PASSWORD;

  if (args[0] === '--bootstrap') {
    // Planos padrão (Essencial, Profissional e Premium) na primeira subida.
    if (ownerUrl) {
      const plans = await bootstrapDefaultPlans(ownerUrl);
      if (plans) console.log(`Planos padrão criados: ${plans}`);
    }
    const email = env.PLATFORM_ADMIN_EMAIL;
    const totpSecret = env.PLATFORM_ADMIN_TOTP_SECRET;
    if (!email || !password || !totpSecret) {
      console.log('Super Admin: variáveis não definidas, nada a criar.');
      return;
    }
    if (!ownerUrl || !key)
      throw new Error('DATABASE_OWNER_URL e INTEGRATIONS_KEY são obrigatórios');
    const created = await bootstrapPlatformAdmin({
      ownerUrl,
      key,
      email,
      name: env.PLATFORM_ADMIN_NAME || 'Administrador',
      password,
      totpSecret,
    });
    console.log(
      created
        ? `Super Admin criado: ${email.toLowerCase()}`
        : 'Super Admin: já existe um administrador, nada alterado.',
    );
    return;
  }

  const reset = args[0] === '--reset';
  const [email, name] = reset ? [args[1], ''] : args;
  if (!email || (!reset && !name) || !ownerUrl || !key || !password) {
    console.error(
      'uso: platform-admin-cli <email> <nome> | --reset <email>  (DATABASE_OWNER_URL, INTEGRATIONS_KEY e PLATFORM_ADMIN_PASSWORD obrigatórios)',
    );
    process.exit(2);
  }
  const input: PlatformAdminInput = {
    ownerUrl,
    key,
    email,
    name,
    password,
    totpSecret: env.PLATFORM_ADMIN_TOTP_SECRET || newTotpSecret(),
  };
  await (reset ? resetPlatformAdmin(input) : createPlatformAdmin(input));
  console.log(`${reset ? 'acesso redefinido' : 'administrador criado'}: ${email}`);
  console.log('Cadastre no aplicativo autenticador (mostrado só agora):');
  console.log(otpauthUri(input.totpSecret, email.toLowerCase()));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
