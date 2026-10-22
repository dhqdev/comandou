#!/usr/bin/env node
// Agente local de impressão do PedeMais.
// Roda no computador do restaurante (Windows, Linux ou macOS com Node.js 22+), busca os
// trabalhos de impressão na API do restaurante e envia para as impressoras térmicas.
//
// Variáveis:
//   PEDEMAIS_URL           endereço do restaurante (ex.: https://burguer.comandou.com)
//   PEDEMAIS_AGENT_TOKEN   token gerado em Impressão > Agentes (começa com "pma_")
//   PRINTER_DEFAULT        impressora padrão: tcp://IP:9100 | file:/caminho | stdout
//   PRINTER_<DESTINO>      impressora de um destino (ex.: PRINTER_CHAPA, PRINTER_CAIXA).
//                          O destino é o nome do setor da cozinha (ou "Caixa"), em
//                          maiúsculas, sem acentos, com "_" no lugar de espaços.
//   POLL_MS                intervalo de busca (padrão 3000)
import { appendFile } from 'node:fs/promises';
import net from 'node:net';
import { toEscPos } from './escpos.mjs';

const VERSION = '0.3.0';
const BASE = (process.env.PEDEMAIS_URL ?? '').replace(/\/+$/, '');
const TOKEN = process.env.PEDEMAIS_AGENT_TOKEN ?? '';
const POLL_MS = Math.max(1000, Number(process.env.POLL_MS ?? 3000));

if (!/^https?:\/\//.test(BASE) || !TOKEN.startsWith('pma_')) {
  console.error('Configure PEDEMAIS_URL (https://...) e PEDEMAIS_AGENT_TOKEN (pma_...).');
  process.exit(1);
}
if (BASE.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(BASE)) {
  console.warn('Aviso: use https em produção; o token trafega no cabeçalho.');
}

function targetEnvName(target) {
  return (
    'PRINTER_' +
    target
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
  );
}

function printerFor(target) {
  return process.env[targetEnvName(target)] ?? process.env.PRINTER_DEFAULT ?? 'stdout';
}

async function api(path, body) {
  const res = await fetch(`${BASE}/api/v1/print-agent${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      'X-PedeMais-Request': '1',
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error(data.message ?? `HTTP ${res.status}`), { status: res.status });
  return data;
}

function sendTcp(host, port, data) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: Number(port) });
    sock.setTimeout(10_000, () => sock.destroy(new Error('Impressora não respondeu')));
    sock.once('error', reject);
    sock.once('connect', () => sock.end(data));
    sock.once('close', (hadError) => (hadError ? undefined : resolve()));
  });
}

async function print(printer, text) {
  if (printer === 'stdout') {
    process.stdout.write(`\n----- impressão -----\n${text}\n---------------------\n`);
    return;
  }
  const data = toEscPos(text);
  if (printer.startsWith('tcp://')) {
    const [host, port = '9100'] = printer.slice(6).split(':');
    return sendTcp(host, port, data);
  }
  if (printer.startsWith('file:')) return appendFile(printer.slice(5), data);
  throw new Error(`Impressora não suportada: ${printer}`);
}

let lastBeat = 0;
async function tick() {
  if (Date.now() - lastBeat > 30_000) {
    const hb = await api('/heartbeat', { version: VERSION });
    if (!lastBeat) console.log(`Conectado: ${hb.restaurant} (agente "${hb.agent}")`);
    lastBeat = Date.now();
  }
  const { jobs } = await api('/claim', { limit: 5 });
  for (const job of jobs) {
    const printer = printerFor(job.target);
    try {
      await print(printer, job.payload);
      await api(`/jobs/${job.id}/result`, { ok: true });
      console.log(`Impresso: ${job.kind} → ${job.target} (${printer})`);
    } catch (err) {
      console.error(`Falha: ${job.kind} → ${job.target} (${printer}): ${err.message}`);
      await api(`/jobs/${job.id}/result`, {
        ok: false,
        error: String(err.message).slice(0, 300),
      }).catch(() => undefined);
    }
  }
}

async function main() {
  console.log(`PedeMais agente de impressão v${VERSION} → ${BASE}`);
  let wait = POLL_MS;
  for (;;) {
    try {
      await tick();
      wait = POLL_MS;
    } catch (err) {
      if (err.status === 401) {
        console.error('Token recusado (agente desativado ou token trocado). Encerrando.');
        process.exit(2);
      }
      wait = Math.min(wait * 2, 60_000);
      console.error(
        `Sem conexão com o PedeMais (${err.message}); nova tentativa em ${wait / 1000}s`,
      );
    }
    await new Promise((r) => setTimeout(r, wait));
  }
}

void main();
