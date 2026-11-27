import '../config/one-shot';
import { resolveFileSecrets } from '../config/env';
import { demoMode, ensureDemoRestaurant, removeDemoRestaurant } from './demo';
import { FUMACA } from './fumaca';

/**
 * Restaurante de demonstração (roda no serviço migrate, depois das migrações).
 *   COMANDOU_DEMO=true        cria uma vez (padrão da stack; não duplica nem sobrescreve os dados;
 *                             só troca fotos/logo de versões antigas)
 *   COMANDOU_DEMO=reset       apaga e cria de novo a cada subida (datas sempre de hoje)
 *   COMANDOU_DEMO=false       desligado
 *   COMANDOU_DEMO_SLUG        endereço da Fumaça Burger (padrão: fumaca → fumaca.<domínio>)
 * As demonstrações antigas (Casa Brasa em "exemplo" e Aurora em "aurora") são removidas na
 * subida, mas só se foram criadas por aqui; um restaurante de verdade nesses endereços fica.
 * Nunca impede a subida do sistema: um erro aqui só aparece no log.
 */
const OLD_DEMOS = ['exemplo', 'aurora'];

async function main() {
  Object.assign(process.env, resolveFileSecrets(process.env));
  const mode = demoMode(process.env.COMANDOU_DEMO);
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  if (!ownerUrl) {
    if (mode === 'off') return console.log('demonstração: desligada (COMANDOU_DEMO)');
    throw new Error('DATABASE_OWNER_URL não definido');
  }
  // Atualizar pelo painel só troca a imagem: a variável da stack antiga continua "exemplo" (ou
  // "aurora"). Esses endereços são das demonstrações antigas e nunca viram a Fumaça.
  const wanted = (process.env.COMANDOU_DEMO_SLUG ?? '').trim().toLowerCase();
  const slug = !wanted || OLD_DEMOS.includes(wanted) ? 'fumaca' : wanted;
  for (const old of OLD_DEMOS) {
    try {
      await removeDemoRestaurant({ ownerUrl, slug: old, log: (m) => console.log(m) });
    } catch (e) {
      console.error(`demonstração: não foi possível remover ${old} (${(e as Error).message})`);
    }
  }
  if (mode === 'off') return console.log('demonstração: desligada (COMANDOU_DEMO)');
  const base = process.env.COMANDOU_BASE_DOMAIN || 'comandou.com';
  try {
    const r = await ensureDemoRestaurant({
      ownerUrl,
      slug,
      emailDomain: `${slug}.${base.replace(/\.localhost$/, '.local')}`,
      mode,
      databaseMode: process.env.TENANT_DATABASE_MODE === 'shared' ? 'shared' : 'dedicated',
      log: (m) => console.log(m),
      catalog: FUMACA,
      baseDomain: base,
    });
    if (r === 'exists') console.log(`demonstração: ${slug} já existe (dados mantidos)`);
  } catch (e) {
    console.error(`demonstração: não foi possível criar ${slug} (${(e as Error).message})`);
  }
}

main().catch((e) => {
  console.error(`demonstração: não foi possível criar (${(e as Error).message})`);
  process.exit(0);
});
