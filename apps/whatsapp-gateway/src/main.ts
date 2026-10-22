import { readFileSync } from 'node:fs';
import makeWASocket, { Browsers, makeCacheableSignalKeyStore } from 'baileys';
import pino from 'pino';
import { createGatewayServer } from './server.js';
import { SessionManager, type SocketLike } from './sessions.js';

/** Lê VAR ou VAR_FILE (Docker secret). */
function secret(name: string): string | undefined {
  const file = process.env[`${name}_FILE`];
  if (file) return readFileSync(file, 'utf8').trim();
  return process.env[name]?.trim() || undefined;
}

const token = secret('GATEWAY_TOKEN');
const keyB64 = secret('SESSION_KEY');
if (!token || token.length < 24)
  throw new Error('GATEWAY_TOKEN ausente ou curto (mínimo 24 caracteres)');
const key = Buffer.from(keyB64 ?? '', 'base64');
if (key.length !== 32) throw new Error('SESSION_KEY deve ter 32 bytes em base64');
const dataDir = process.env.DATA_DIR ?? '/data';
const port = Number(process.env.PORT ?? 3100);
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
// O Baileys registra muita coisa (inclusive dados de mensagens): fica só em "error".
const baileysLogger = logger.child({ module: 'baileys' }, { level: 'error' });

const sessions = new SessionManager(
  dataDir,
  key,
  (state) =>
    makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
      logger: baileysLogger,
      browser: Browsers.ubuntu('Comandou'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
    }) as unknown as SocketLike,
  (msg) => logger.info(msg),
);

const server = createGatewayServer(sessions, token);
server.listen(port, '0.0.0.0', () => logger.info(`whatsapp-gateway ouvindo na porta ${port}`));
void sessions.restoreAll().catch((e: Error) => logger.error(`restaurar sessões: ${e.message}`));

for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    sessions.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
