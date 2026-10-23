import { resolveFileSecrets } from '../config/env';
import { demoMode, ensureDemoRestaurant } from './demo';

/**
 * Restaurante de demonstração (roda no serviço migrate, depois das migrações).
 *   COMANDOU_DEMO=true     cria uma vez (padrão da stack; não duplica nem sobrescreve)
 *   COMANDOU_DEMO=reset    apaga e cria de novo a cada subida (datas sempre de hoje)
 *   COMANDOU_DEMO=false    desligado
 *   COMANDOU_DEMO_SLUG     endereço (padrão: exemplo → exemplo.<domínio>)
 * Nunca impede a subida do sistema: um erro aqui só aparece no log.
 */
async function main() {
  Object.assign(process.env, resolveFileSecrets(process.env));
  const mode = demoMode(process.env.COMANDOU_DEMO);
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  if (mode === 'off') {
    console.log('demonstração: desligada (COMANDOU_DEMO)');
    return;
  }
  if (!ownerUrl) throw new Error('DATABASE_OWNER_URL não definido');
  const slug = process.env.COMANDOU_DEMO_SLUG || 'exemplo';
  const base = process.env.COMANDOU_BASE_DOMAIN || 'comandou.com';
  const r = await ensureDemoRestaurant({
    ownerUrl,
    slug,
    emailDomain: `${slug}.${base.replace(/\.localhost$/, '.local')}`,
    mode,
    databaseMode: process.env.TENANT_DATABASE_MODE === 'shared' ? 'shared' : 'dedicated',
    log: (m) => console.log(m),
  });
  if (r === 'exists') console.log(`demonstração: ${slug} já existe; nada alterado`);
}

main().catch((e) => {
  console.error(`demonstração: não foi possível criar (${(e as Error).message})`);
  process.exit(0);
});
