// mDNS / Bonjour (RFC 6762 e 6763), sem dependências: pergunta na rede local quem anuncia
// impressora e devolve nome, IP e porta. Impressoras de rede e Wi-Fi da Epson, Elgin, Bematech,
// Star e outras anunciam "_pdl-datastream._tcp" (a porta RAW 9100); as de escritório anunciam
// "_ipp._tcp" e "_printer._tcp". Só pergunta: nada é enviado para a impressora.
import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';

export const PRINTER_SERVICES = [
  '_pdl-datastream._tcp.local',
  '_printer._tcp.local',
  '_ipp._tcp.local',
];

const TYPE = { A: 1, PTR: 12, TXT: 16, SRV: 33 };

function encodeName(name) {
  const parts = name.split('.').filter(Boolean);
  const out = [];
  for (const p of parts) {
    const b = Buffer.from(p, 'utf8');
    if (b.length > 63) throw new Error('rótulo grande demais');
    out.push(Buffer.from([b.length]), b);
  }
  out.push(Buffer.from([0]));
  return Buffer.concat(out);
}

/** Pergunta PTR (uma por serviço), pedindo resposta direta (bit QU). */
export function buildQuery(services = PRINTER_SERVICES) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(services.length, 4);
  const qs = services.map((s) => {
    const tail = Buffer.alloc(4);
    tail.writeUInt16BE(TYPE.PTR, 0);
    tail.writeUInt16BE(0x8001, 2); // QU + classe IN
    return Buffer.concat([encodeName(s), tail]);
  });
  return Buffer.concat([header, ...qs]);
}

/** Lê um nome com ponteiros de compressão; devolve o nome e onde ele termina no pacote. */
function readName(buf, offset) {
  const labels = [];
  let pos = offset;
  let end = -1;
  for (let jumps = 0; jumps < 32; jumps++) {
    if (pos >= buf.length) throw new Error('nome cortado');
    const len = buf[pos];
    if (len === 0) {
      if (end < 0) end = pos + 1;
      return { name: labels.join('.'), end };
    }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) throw new Error('ponteiro cortado');
      if (end < 0) end = pos + 2;
      pos = ((len & 0x3f) << 8) | buf[pos + 1];
      continue;
    }
    if (pos + 1 + len > buf.length) throw new Error('rótulo cortado');
    labels.push(buf.toString('utf8', pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  throw new Error('ponteiros demais');
}

/**
 * Registros de um pacote de resposta (respostas + adicionais).
 * @returns {{ name: string, type: number, data: any }[]}
 */
export function parseResponse(buf) {
  if (buf.length < 12) return [];
  const qd = buf.readUInt16BE(4);
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let pos = 12;
  try {
    for (let i = 0; i < qd; i++) pos = readName(buf, pos).end + 4;
    const out = [];
    for (let i = 0; i < total && pos < buf.length; i++) {
      const n = readName(buf, pos);
      pos = n.end;
      if (pos + 10 > buf.length) break;
      const type = buf.readUInt16BE(pos);
      const len = buf.readUInt16BE(pos + 8);
      const start = pos + 10;
      pos = start + len;
      if (pos > buf.length) break;
      let data;
      if (type === TYPE.A && len === 4) data = [...buf.subarray(start, start + 4)].join('.');
      else if (type === TYPE.PTR) data = readName(buf, start).name;
      else if (type === TYPE.SRV && len >= 7)
        data = { port: buf.readUInt16BE(start + 4), target: readName(buf, start + 6).name };
      else if (type === TYPE.TXT) {
        data = {};
        for (let p = start; p < start + len;) {
          const l = buf[p];
          const kv = buf.toString('utf8', p + 1, p + 1 + l);
          const eq = kv.indexOf('=');
          if (eq > 0) data[kv.slice(0, eq).toLowerCase()] = kv.slice(eq + 1);
          p += 1 + l;
        }
      } else continue;
      out.push({ name: n.name.toLowerCase(), type, data });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Junta os registros recebidos em impressoras: { host, port, name, service }.
 * `fromIp` é quem respondeu (vale quando o pacote não traz o registro A).
 */
export function collectPrinters(records, fromIp) {
  const srv = new Map();
  const txt = new Map();
  const addr = new Map();
  const ptr = [];
  for (const r of records) {
    if (r.type === TYPE.SRV) srv.set(r.name, r.data);
    else if (r.type === TYPE.TXT) txt.set(r.name, r.data);
    else if (r.type === TYPE.A) addr.set(r.name, r.data);
    else if (r.type === TYPE.PTR && PRINTER_SERVICES.includes(r.name)) ptr.push(r);
  }
  const out = [];
  for (const p of ptr) {
    const inst = p.data.toLowerCase();
    const s = srv.get(inst);
    const host = (s && addr.get(s.target.toLowerCase())) || fromIp;
    if (!host) continue;
    const t = txt.get(inst) ?? {};
    const label = p.data.slice(0, p.data.length - p.name.length - 1) || p.data;
    const model = [t.usb_mfg, t.usb_mdl].filter(Boolean).join(' ') || t.ty || '';
    out.push({
      host,
      port: s?.port ?? (p.name.startsWith('_pdl') ? 9100 : 0),
      name: (model && !label.includes(model) ? `${label} (${model})` : label).slice(0, 80),
      service: p.name.split('.')[0].slice(1),
    });
  }
  return out;
}

/** IPv4 das placas de rede (onde a pergunta é feita). */
function localAddresses(ifaces = networkInterfaces()) {
  const out = [];
  for (const list of Object.values(ifaces))
    for (const a of list ?? [])
      if (
        (a.family === 'IPv4' || a.family === 4) &&
        !a.internal &&
        !a.address.startsWith('169.254.')
      )
        out.push(a.address);
  return out;
}

/**
 * Pergunta na rede local por `timeoutMs` e devolve as impressoras que responderam.
 * Rede sem multicast (algumas de visitante) simplesmente não responde: volta vazio.
 */
export function browsePrinters({ timeoutMs = 2500, services = PRINTER_SERVICES } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const sockets = [];
    const query = buildQuery(services);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      for (const s of sockets) s.close();
      resolve([...found.values()]);
    };
    const addrs = localAddresses();
    if (!addrs.length) return resolve([]);
    // Placa que não abre (bind falhou) nunca chama o retorno: o prazo encerra de qualquer jeito.
    const guard = setTimeout(finish, timeoutMs + 2000);
    let pending = addrs.length;
    for (const ip of addrs) {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sockets.push(s);
      s.on('error', () => undefined);
      s.on('message', (msg, rinfo) => {
        for (const p of collectPrinters(parseResponse(msg), rinfo.address)) {
          const key = `${p.host}:${p.service}`;
          if (!found.has(key)) found.set(key, p);
        }
      });
      s.bind({ address: ip, port: 0 }, () => {
        try {
          s.setMulticastInterface(ip);
          s.setMulticastTTL(255);
          s.send(query, 5353, '224.0.0.251');
          // Segunda pergunta: algumas impressoras perdem a primeira logo depois de acordar.
          setTimeout(() => {
            if (!finished) s.send(query, 5353, '224.0.0.251', () => undefined);
          }, 700);
        } catch {
          /* placa sem multicast */
        }
        if (--pending === 0) setTimeout(finish, timeoutMs);
      });
    }
  });
}
