import { resolveFileSecrets } from '../config/env';
import { AURORA } from './aurora';
import { CASA_BRASA } from './catalog';
import { demoMode, ensureDemoRestaurant } from './demo';

/**
 * Restaurantes de demonstração (roda no serviço migrate, depois das migrações).
 *   COMANDOU_DEMO=true        cria uma vez (padrão da stack; não duplica nem sobrescreve)
 *   COMANDOU_DEMO=reset       apaga e cria de novo a cada subida (datas sempre de hoje)
 *   COMANDOU_DEMO=false       desligado
 *   COMANDOU_DEMO_SLUG        endereço da Casa Brasa (padrão: exemplo → exemplo.<domínio>)
 *   COMANDOU_DEMO2_SLUG       endereço da Aurora Café & Padaria (padrão: aurora; "false" desliga só ela)
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
  const base = process.env.COMANDOU_BASE_DOMAIN || 'comandou.com';
  const second = (process.env.COMANDOU_DEMO2_SLUG ?? '').trim();
  const demos = [
    { slug: process.env.COMANDOU_DEMO_SLUG || 'exemplo', catalog: CASA_BRASA },
    ...(['false', 'off', 'nao', 'não', '0'].includes(second.toLowerCase())
      ? []
      : [{ slug: second || 'aurora', catalog: AURORA }]),
  ];
  for (const d of demos) {
    try {
      const r = await ensureDemoRestaurant({
        ownerUrl,
        slug: d.slug,
        emailDomain: `${d.slug}.${base.replace(/\.localhost$/, '.local')}`,
        mode,
        databaseMode: process.env.TENANT_DATABASE_MODE === 'shared' ? 'shared' : 'dedicated',
        log: (m) => console.log(m),
        catalog: d.catalog,
        baseDomain: base,
      });
      if (r === 'exists') console.log(`demonstração: ${d.slug} já existe; nada alterado`);
    } catch (e) {
      console.error(`demonstração: não foi possível criar ${d.slug} (${(e as Error).message})`);
    }
  }
}

main().catch((e) => {
  console.error(`demonstração: não foi possível criar (${(e as Error).message})`);
  process.exit(0);
});
