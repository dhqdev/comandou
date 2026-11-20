// SNMP v2c (só leitura, comunidade "public"), sem dependências: pergunta à impressora de rede o
// modelo, o número de série, a situação, o contador de páginas e o nível de tinta/toner (MIBs
// padrão HOST-RESOURCES e Printer-MIB, RFC 2790 e 3805). Quase toda impressora de rede responde;
// a que não responde só fica sem esses detalhes.
import dgram from 'node:dgram';

// ------------------------------------------------------------------ BER (o mínimo do SNMP)
function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
function int(n) {
  const bytes = [];
  let v = n;
  do {
    bytes.unshift(v & 0xff);
    v >>= 8;
  } while (v !== 0 && v !== -1);
  if (n >= 0 && bytes[0] & 0x80) bytes.unshift(0);
  return tlv(0x02, Buffer.from(bytes));
}
function oid(text) {
  const p = text.split('.').map(Number);
  const out = [p[0] * 40 + p[1]];
  for (const n of p.slice(2)) {
    const sub = [];
    let v = n;
    do {
      sub.unshift(v & 0x7f);
      v = Math.floor(v / 128);
    } while (v > 0);
    for (let i = 0; i < sub.length - 1; i++) sub[i] |= 0x80;
    out.push(...sub);
  }
  return tlv(0x06, Buffer.from(out));
}

function value(v) {
  if (v === null || v === undefined) return tlv(0x05, Buffer.alloc(0));
  if (typeof v === 'number') return int(v);
  if (typeof v === 'object' && 'counter' in v) return tlv(0x41, int(v.counter).subarray(2));
  return tlv(0x04, Buffer.isBuffer(v) ? v : Buffer.from(String(v)));
}

/** Mensagem SNMP v2c: `pdu` 0xA0 (GetRequest) ou 0xA2 (Response); binds = [oid, valor][]. */
export function buildMessage(pdu, binds, requestId = 1, community = 'public') {
  const list = tlv(
    0x30,
    Buffer.concat(binds.map(([o, v]) => tlv(0x30, Buffer.concat([oid(o), value(v)])))),
  );
  const body = tlv(pdu, Buffer.concat([int(requestId), int(0), int(0), list]));
  return tlv(0x30, Buffer.concat([int(1), tlv(0x04, Buffer.from(community)), body]));
}

/** Pacote GetRequest v2c com as OIDs pedidas. */
export const buildGet = (oids, requestId = 1, community = 'public') =>
  buildMessage(
    0xa0,
    oids.map((o) => [o, null]),
    requestId,
    community,
  );

function read(buf, pos) {
  const tag = buf[pos];
  let l = buf[pos + 1];
  let start = pos + 2;
  if (l & 0x80) {
    const n = l & 0x7f;
    l = 0;
    for (let i = 0; i < n; i++) l = l * 256 + buf[start + i];
    start += n;
  }
  if (start + l > buf.length) throw new Error('SNMP truncado');
  return { tag, start, end: start + l, body: buf.subarray(start, start + l) };
}
function readInt(b, signed = true) {
  let v = 0;
  for (const x of b) v = v * 256 + x;
  return signed && b.length && b[0] & 0x80 ? v - 2 ** (8 * b.length) : v;
}
function readOid(b) {
  const out = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (const x of b.subarray(1)) {
    v = v * 128 + (x & 0x7f);
    if (!(x & 0x80)) {
      out.push(v);
      v = 0;
    }
  }
  return out.join('.');
}

/** Resposta → Map(oid → valor). OID que a impressora não tem fica de fora. */
export function parseResponse(buf) {
  const out = new Map();
  const msg = read(buf, 0);
  let p = msg.start;
  p = read(buf, p).end; // versão
  p = read(buf, p).end; // comunidade
  const pdu = read(buf, p);
  if (pdu.tag !== 0xa2) return out;
  let q = pdu.start;
  q = read(buf, q).end; // request-id
  q = read(buf, q).end; // error-status
  q = read(buf, q).end; // error-index
  const binds = read(buf, q);
  for (let b = binds.start; b < binds.end;) {
    const vb = read(buf, b);
    b = vb.end;
    const o = read(buf, vb.start);
    const v = read(buf, o.end);
    const key = readOid(o.body);
    if (v.tag === 0x02) out.set(key, readInt(v.body));
    else if (v.tag >= 0x41 && v.tag <= 0x43) out.set(key, readInt(v.body, false));
    else if (v.tag === 0x04) out.set(key, Buffer.from(v.body));
    else if (v.tag === 0x40) out.set(key, [...v.body].join('.'));
    else if (v.tag === 0x06) out.set(key, readOid(v.body));
  }
  return out;
}

/** Pergunta as OIDs a um IP (UDP 161). Sem resposta: Map vazio. */
export function snmpGet(host, oids, { timeoutMs = 1500, community = 'public' } = {}) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const id = Math.floor(Math.random() * 0x7fffffff);
    const done = (m) => {
      clearTimeout(t);
      try {
        sock.close();
      } catch {
        /* já fechado */
      }
      resolve(m);
    };
    const t = setTimeout(() => done(new Map()), timeoutMs);
    sock.on('error', () => done(new Map()));
    sock.on('message', (msg) => {
      try {
        done(parseResponse(msg));
      } catch {
        done(new Map());
      }
    });
    sock.send(buildGet(oids, id, community), 161, host, (err) => err && done(new Map()));
  });
}

// ------------------------------------------------------------------ o que perguntar
const SYS = '1.3.6.1.2.1.1';
const HR = '1.3.6.1.2.1.25.3';
const PRT = '1.3.6.1.2.1.43';
const SUPPLIES = 8;
export const OIDS = {
  descr: `${SYS}.1.0`,
  sysName: `${SYS}.5.0`,
  location: `${SYS}.6.0`,
  model: `${HR}.2.1.3.1`,
  status: `${HR}.5.1.1.1`,
  errors: `${HR}.5.1.2.1`,
  serial: `${PRT}.5.1.1.17.1`,
  pages: `${PRT}.10.2.1.4.1.1`,
};
export const supplyOids = (i) => [
  `${PRT}.11.1.1.6.1.${i}`,
  `${PRT}.11.1.1.8.1.${i}`,
  `${PRT}.11.1.1.9.1.${i}`,
];

const STATUS = { 1: 'outro', 3: 'Pronta', 4: 'Imprimindo', 5: 'Esquentando' };
// hrPrinterDetectedErrorState: bit 7 do 1º byte é o primeiro (lowPaper)...
const ERRORS = [
  'Pouco papel',
  'Sem papel',
  'Pouco toner/tinta',
  'Sem toner/tinta',
  'Tampa aberta',
  'Papel enroscado',
  'Desligada da rede (offline)',
  'Precisa de manutenção',
  'Bandeja de entrada fora',
  'Bandeja de saída fora',
  'Falta cartucho/toner',
  'Bandeja de saída quase cheia',
  'Bandeja de saída cheia',
  'Bandeja de entrada vazia',
  'Manutenção preventiva atrasada',
];

const text = (v) =>
  Buffer.isBuffer(v)
    ? v
        .toString('utf8')
        .replace(/\0+$/g, '')
        .replace(/[\x00-\x1f]/g, ' ')
        .trim() || null
    : v == null
      ? null
      : String(v);

/** Monta o resumo a partir das respostas (testado com respostas de exemplo). */
export function summarize(general, supplies = new Map()) {
  if (!general.size && !supplies.size) return null;
  const errBytes = general.get(OIDS.errors);
  const problems = [];
  if (Buffer.isBuffer(errBytes))
    ERRORS.forEach((label, i) => {
      const byte = errBytes[i >> 3] ?? 0;
      if (byte & (0x80 >> (i & 7))) problems.push(label);
    });
  const list = [];
  for (let i = 1; i <= SUPPLIES; i++) {
    const [d, m, l] = supplyOids(i);
    const name = text(supplies.get(d));
    if (!name) continue;
    const max = supplies.get(m);
    const level = supplies.get(l);
    // -3: "tem um pouco"; -2/-1: não sabe. Percentual só com o máximo conhecido.
    const pct =
      typeof level === 'number' && typeof max === 'number' && max > 0 && level >= 0
        ? Math.max(0, Math.min(100, Math.round((level / max) * 100)))
        : null;
    list.push({ name: name.slice(0, 60), level: pct, some: level === -3 });
  }
  const st = general.get(OIDS.status);
  return {
    model: text(general.get(OIDS.model)),
    description: text(general.get(OIDS.descr)),
    sysName: text(general.get(OIDS.sysName)),
    location: text(general.get(OIDS.location)),
    serial: text(general.get(OIDS.serial)),
    pages: typeof general.get(OIDS.pages) === 'number' ? general.get(OIDS.pages) : null,
    status: STATUS[st] ?? null,
    problems,
    supplies: list,
  };
}

/** Tudo o que a impressora conta por SNMP, ou null se ela não responde. */
export async function snmpPrinter(host, o = {}) {
  const general = await snmpGet(host, Object.values(OIDS), o);
  if (!general.size) return null;
  const supplies = await snmpGet(
    host,
    Array.from({ length: SUPPLIES }, (_, i) => supplyOids(i + 1)).flat(),
    o,
  );
  return summarize(general, supplies);
}
