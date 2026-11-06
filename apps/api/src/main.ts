import 'reflect-metadata';
import { createApp } from './bootstrap';
import { loadEnv, resolveFileSecrets } from './config/env';

/**
 * Uma promessa rejeitada sem tratamento (num serviço externo, num trabalho de fundo de um
 * restaurante) derrubaria o processo inteiro no Node 22, e com ele todos os restaurantes
 * atendidos por esta réplica. Registra e segue; o erro do restaurante fica só com ele.
 */
process.on('unhandledRejection', (reason) => {
  console.error(
    JSON.stringify({
      level: 50,
      msg: 'promessa rejeitada sem tratamento',
      err: reason instanceof Error ? reason.stack : String(reason),
    }),
  );
});

async function main() {
  const env = loadEnv(resolveFileSecrets(process.env));
  const app = await createApp(env);
  await app.listen(env.PORT, '0.0.0.0');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
