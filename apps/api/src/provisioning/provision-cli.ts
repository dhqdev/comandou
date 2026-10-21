import { provisionTenant } from './provision';

/**
 * Uso:
 *   DATABASE_OWNER_URL=... PROVISION_ADMIN_PASSWORD=... \
 *   node dist/provisioning/provision-cli.js <slug> "<Nome>" <admin-email> "<Nome do admin>"
 * A senha vem por variável de ambiente para não aparecer no histórico do shell nem em logs.
 */
async function main() {
  const [slug, name, adminEmail, adminName] = process.argv.slice(2);
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  const adminPassword = process.env.PROVISION_ADMIN_PASSWORD;
  if (!slug || !name || !adminEmail || !adminName || !ownerUrl || !adminPassword) {
    console.error(
      'uso: provision-cli <slug> <nome> <admin-email> <admin-nome>  (DATABASE_OWNER_URL e PROVISION_ADMIN_PASSWORD obrigatórios)',
    );
    process.exit(2);
  }
  const r = await provisionTenant(ownerUrl, { slug, name, adminEmail, adminName, adminPassword });
  console.log(
    `tenant ${slug} (${r.tenantId}) status=${r.status} etapas=${r.stepsRun.join(',') || 'nenhuma'}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
