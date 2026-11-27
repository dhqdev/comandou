import { readFileSync } from 'node:fs';
import makeWASocket, {
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WAVersion,
} from 'baileys';
import pino from 'pino';
import { DEVICE_BROWSER } from './device.js';
import { InboundForwarder } from './forwarder.js';
import { createGatewayServer } from './server.js';
import { DEFAULT_TIMINGS, SessionManager, type SocketLike } from './sessions.js';

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
// Uma sessão (um restaurante) com erro assíncrono do WhatsApp não pode derrubar o processo e,
// com ele, o WhatsApp de todos os restaurantes. Registra e segue.
process.on('unhandledRejection', (reason) => {
  logger.error(
    `promessa rejeitada sem tratamento: ${reason instanceof Error ? reason.message : String(reason)}`,
  );
});
// O Baileys registra muita coisa (inclusive dados de mensagens): fica só em "error".
const baileysLogger = logger.child({ module: 'baileys' }, { level: 'error' });

// Versão do WhatsApp Web anunciada na conexão. A que vem no pacote envelhece e o WhatsApp passa
// a recusar (erro 405): busca a atual ao iniciar, a cada 12 h e logo depois de um 405 (no máximo
// uma vez a cada 10 min); sem rede, fica a do pacote.
let waVersion: WAVersion | undefined;
let versionAt = 0;
async function refreshVersion() {
  versionAt = Date.now();
  const r = await fetchLatestBaileysVersion({ timeout: 5000 }).catch(() => undefined);
  if (r?.isLatest) waVersion = r.version;
  logger.info(
    `versão do WhatsApp Web: ${(r?.version ?? []).join('.')}${r?.isLatest ? '' : ' (do pacote)'}`,
  );
}
setInterval(() => void refreshVersion(), 12 * 3600_000).unref();
function versionRejected() {
  if (Date.now() - versionAt < 10 * 60_000) return;
  logger.warn('o WhatsApp recusou a versão (405): buscando a atual');
  void refreshVersion();
}

// Mensagens que os clientes mandam vão para a API (o atendimento por IA responde por lá).
// Ex.: http://api:3000/api/v1/internal/whatsapp/inbound. Sem a variável, não repassa nada.
const inboundUrl = process.env.INBOUND_URL?.trim() || undefined;
if (!inboundUrl)
  logger.warn(
    'INBOUND_URL não configurada: as mensagens que os clientes mandam NÃO vão para a API e a IA não responde. ' +
      'Defina, por exemplo, INBOUND_URL=http://api:3000/api/v1/internal/whatsapp/inbound (nome do serviço da API na stack).',
  );
const forwardConcurrency = Number(process.env.INBOUND_CONCURRENCY ?? 64);
const forwarder = inboundUrl
  ? new InboundForwarder(inboundUrl, token, (msg) => logger.warn(msg), {
      concurrency: forwardConcurrency > 0 ? forwardConcurrency : 64,
    })
  : undefined;

const sessions = new SessionManager(
  dataDir,
  key,
  (state, { getMessage }) =>
    makeWASocket({
      ...(waVersion ? { version: waVersion } : {}),
      getMessage,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
      logger: baileysLogger,
      // No celular, em "Aparelhos conectados": "Mac OS", um computador (ver device.ts).
      browser: DEVICE_BROWSER,
      // "offline" ao conectar: o celular do restaurante continua recebendo as notificações.
      // O gateway fica "online" só enquanto responde (digitando...) e volta sozinho.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
      // Ping a cada 20 s: NAT/proxy costuma matar conexão TCP ociosa sem avisar (era isso que
      // fazia o WhatsApp parar de responder depois de horas sem conversa).
      keepAliveIntervalMs: DEFAULT_TIMINGS.keepAliveMs,
      connectTimeoutMs: 30_000,
      defaultQueryTimeoutMs: 60_000,
    }) as unknown as SocketLike,
  (msg) => logger.info(msg),
  {
    onInbound: forwarder ? (m) => forwarder.push(m) : undefined,
    onVersionRejected: versionRejected,
  },
);

const server = createGatewayServer(sessions, token, () =>
  forwarder ? { inbound: { pending: forwarder.pending, inFlight: forwarder.inFlight } } : {},
);
server.listen(port, '0.0.0.0', () => logger.info(`whatsapp-gateway ouvindo na porta ${port}`));
void refreshVersion()
  .then(() => sessions.restoreAll())
  .catch((e: Error) => logger.error(`restaurar sessões: ${e.message}`));

for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    forwarder?.close();
    sessions.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
