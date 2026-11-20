// IPP (RFC 8010/8011), sem dependências: pergunta à impressora de rede (porta 631) o modelo, a
// situação, os níveis de tinta/toner e o que ela sabe fazer (cor, frente e verso, papéis). É o
// mesmo protocolo do AirPrint e do Mopria: quase toda jato de tinta e laser de rede responde.
import http from 'node:http';

const TAG = { operation: 0x01, end: 0x03, charset: 0x47, language: 0x48, uri: 0x45, keyword: 0x44 };

export const WANTED = [
  'printer-make-and-model',
  'printer-name',
  'printer-info',
  'printer-location',
  'printer-state',
  'printer-state-reasons',
  'printer-state-message',
  'printer-device-id',
  'printer-firmware-string-version',
  'printer-more-info',
  'printer-uuid',
  'marker-names',
  'marker-levels',
  'marker-colors',
  'marker-types',
  'color-supported',
  'sides-supported',
  'media-ready',
  'media-default',
  'printer-resolution-default',
  'queued-job-count',
  'printer-kind',
];

/** Um atributo IPP (tag, nome, valor em bytes). */
export function attr(tag, name, value) {
  const n = Buffer.from(name);
  const v = Buffer.from(value);
  const b = Buffer.alloc(1 + 2 + n.length + 2 + v.length);
  b[0] = tag;
  b.writeUInt16BE(n.length, 1);
  n.copy(b, 3);
  b.writeUInt16BE(v.length, 3 + n.length);
  v.copy(b, 5 + n.length);
  return b;
}

/** Pedido Get-Printer-Attributes (operação 0x000B). */
export function buildRequest(printerUri, requestId = 1) {
  const head = Buffer.alloc(8);
  head.writeUInt8(2, 0); // IPP 2.0
  head.writeUInt8(0, 1);
  head.writeUInt16BE(0x000b, 2);
  head.writeUInt32BE(requestId, 4);
  return Buffer.concat([
    head,
    Buffer.from([TAG.operation]),
    attr(TAG.charset, 'attributes-charset', 'utf-8'),
    attr(TAG.language, 'attributes-natural-language', 'pt-br'),
    attr(TAG.uri, 'printer-uri', printerUri),
    ...WANTED.map((w, i) => attr(TAG.keyword, i === 0 ? 'requested-attributes' : '', w)),
    Buffer.from([TAG.end]),
  ]);
}

/** Resposta → { status, attrs: { nome: valor | valor[] } } (só o grupo da impressora). */
export function parseResponse(buf) {
  if (buf.length < 9) throw new Error('IPP curto');
  const status = buf.readUInt16BE(2);
  const attrs = {};
  let pos = 8;
  let last = null;
  let group = 0;
  while (pos < buf.length) {
    const tag = buf[pos++];
    if (tag === TAG.end) break;
    if (tag < 0x10) {
      group = tag;
      continue;
    }
    const nl = buf.readUInt16BE(pos);
    const name = buf.toString('utf8', pos + 2, pos + 2 + nl);
    pos += 2 + nl;
    const vl = buf.readUInt16BE(pos);
    const raw = buf.subarray(pos + 2, pos + 2 + vl);
    pos += 2 + vl;
    if (group !== 0x04) {
      if (name) last = null;
      continue;
    }
    let value;
    if (tag === 0x21 || tag === 0x23) value = raw.length === 4 ? raw.readInt32BE(0) : null;
    else if (tag === 0x22) value = raw[0] === 1;
    else if (tag === 0x32 && raw.length === 9)
      value = `${raw.readInt32BE(0)}x${raw.readInt32BE(4)} ${raw[8] === 3 ? 'dpi' : 'dpcm'}`;
    else if (tag === 0x35 || tag === 0x36) {
      const ll = raw.readUInt16BE(0);
      const tl = raw.readUInt16BE(2 + ll);
      value = raw.toString('utf8', 4 + ll, 4 + ll + tl);
    } else if (tag >= 0x40) value = raw.toString('utf8');
    else continue; // fora de faixa, data e outros que não usamos
    if (name) {
      last = name;
      attrs[name] = value;
    } else if (last) {
      attrs[last] = [].concat(attrs[last], value);
    }
  }
  return { status, attrs };
}

const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const STATE = { 3: 'Pronta', 4: 'Imprimindo', 5: 'Parada' };
const REASON = {
  'media-empty': 'Sem papel',
  'media-needed': 'Sem papel',
  'media-low': 'Pouco papel',
  'media-jam': 'Papel enroscado',
  'toner-low': 'Pouco toner',
  'toner-empty': 'Sem toner',
  'marker-supply-low': 'Pouca tinta',
  'marker-supply-empty': 'Sem tinta',
  'marker-waste-almost-full': 'Almofada de tinta quase cheia',
  'marker-waste-full': 'Almofada de tinta cheia',
  'door-open': 'Tampa aberta',
  'cover-open': 'Tampa aberta',
  'input-tray-missing': 'Bandeja fora',
  'output-area-full': 'Bandeja de saída cheia',
  offline: 'Offline',
  paused: 'Pausada',
  'spool-area-full': 'Memória cheia',
};
const SIDES = (v) => list(v).some((s) => String(s).startsWith('two-sided'));

/** Resumo legível da resposta (testado com uma resposta de exemplo). */
export function summarize(attrs) {
  const names = list(attrs['marker-names']);
  const levels = list(attrs['marker-levels']);
  const colors = list(attrs['marker-colors']);
  const device = String(attrs['printer-device-id'] ?? '');
  const dev = Object.fromEntries(
    device
      .split(';')
      .map((kv) => kv.split(':'))
      .filter((p) => p.length >= 2)
      .map(([k, ...v]) => [k.trim().toUpperCase(), v.join(':').trim()]),
  );
  return {
    model:
      attrs['printer-make-and-model'] ||
      [dev.MFG ?? dev.MANUFACTURER, dev.MDL ?? dev.MODEL].filter(Boolean).join(' ') ||
      null,
    name: attrs['printer-name'] ?? null,
    info: attrs['printer-info'] ?? null,
    location: attrs['printer-location'] || null,
    status: STATE[attrs['printer-state']] ?? null,
    message: attrs['printer-state-message'] || null,
    problems: [
      ...new Set(
        list(attrs['printer-state-reasons'])
          .map((r) => REASON[String(r).replace(/-(report|warning|error)$/, '')])
          .filter(Boolean),
      ),
    ],
    supplies: names.map((n, i) => ({
      name: String(n).slice(0, 60),
      level: typeof levels[i] === 'number' && levels[i] >= 0 ? Math.min(100, levels[i]) : null,
      color: /^#[0-9a-f]{6}$/i.test(String(colors[i] ?? '')) ? String(colors[i]) : null,
    })),
    color: typeof attrs['color-supported'] === 'boolean' ? attrs['color-supported'] : null,
    duplex: attrs['sides-supported'] !== undefined ? SIDES(attrs['sides-supported']) : null,
    paper: list(attrs['media-ready']).length
      ? list(attrs['media-ready']).map(String)
      : list(attrs['media-default']).map(String),
    resolution: attrs['printer-resolution-default'] ?? null,
    firmware: list(attrs['printer-firmware-string-version'])[0] ?? null,
    web: attrs['printer-more-info'] ?? null,
    jobs: typeof attrs['queued-job-count'] === 'number' ? attrs['queued-job-count'] : null,
    commandSet: dev.CMD ?? dev['COMMAND SET'] ?? null,
  };
}

function post(host, port, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host,
        port,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/ipp', 'content-length': body.length },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > 512_000) req.destroy(new Error('IPP grande demais'));
          else chunks.push(c);
        });
        res.on('end', () =>
          res.statusCode === 200
            ? resolve(Buffer.concat(chunks))
            : reject(new Error(`HTTP ${res.statusCode}`)),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error('sem resposta')));
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Pergunta à impressora pelo IPP. `paths`: o "rp" do Bonjour primeiro, depois os de costume.
 * Devolve { path, ...resumo } ou null.
 */
export async function ippPrinter(host, { port = 631, paths = [], timeoutMs = 2500 } = {}) {
  const tries = [...new Set([...paths, 'ipp/print', 'ipp', ''])];
  for (const p of tries) {
    const path = `/${p.replace(/^\/+/, '')}`;
    try {
      const buf = await post(
        host,
        port,
        path,
        buildRequest(`ipp://${host}:${port}${path}`),
        timeoutMs,
      );
      const r = parseResponse(buf);
      if (r.status < 0x0100 && Object.keys(r.attrs).length)
        return { path: path.slice(1), ...summarize(r.attrs) };
    } catch (e) {
      if (/ECONNREFUSED|sem resposta|EHOSTUNREACH/.test(e.message)) return null;
    }
  }
  return null;
}
