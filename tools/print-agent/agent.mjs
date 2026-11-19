#!/usr/bin/env node
// Agente de impressão do Comandou em linha de comando (servidores e Linux sem tela).
// Para o computador do caixa, prefira o aplicativo "Comandou Impressão" (pasta desktop/).
//
// Variáveis:
//   COMANDOU_CODE          código de conexão copiado do painel (CMD1-...), OU as duas abaixo:
//   COMANDOU_URL           endereço do restaurante (ex.: https://burguer.comandou.com)
//   COMANDOU_AGENT_TOKEN   token gerado em Impressão (começa com "pma_")
//   PRINTER_DEFAULT        impressora padrão: tcp://IP:9100 | printer:NOME | serial:COM5 |
//                          serial:/dev/rfcomm0 | file:/dev/usb/lp0 | stdout
//                          (ajustes no fim: ?papel=58&acentos=850&baud=19200)
//   PRINTER_<DESTINO>      impressora de um destino (ex.: PRINTER_CHAPA, PRINTER_CAIXA).
//                          O destino é o nome do setor da cozinha (ou "Caixa"), em
//                          maiúsculas, sem acentos, com "_" no lugar de espaços.
//   POLL_MS                intervalo de busca (padrão 3000)
import { PrintAgent, parseConnectionCode } from './core.mjs';
import { printResilient } from './devices.mjs';
import { describePrinter, targetEnvName } from './printers.mjs';

const VERSION = '1.3.0';

let url = (process.env.COMANDOU_URL ?? '').replace(/\/+$/, '');
let token = process.env.COMANDOU_AGENT_TOKEN ?? '';
if (process.env.COMANDOU_CODE) {
  try {
    ({ url, token } = parseConnectionCode(process.env.COMANDOU_CODE));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
if (!/^https?:\/\//.test(url) || !token.startsWith('pma_')) {
  console.error('Configure COMANDOU_CODE (CMD1-...) ou COMANDOU_URL e COMANDOU_AGENT_TOKEN.');
  process.exit(1);
}
if (url.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(url)) {
  console.warn('Aviso: use https em produção; o token trafega no cabeçalho.');
}

const printerFor = (target) =>
  process.env[targetEnvName(target)] ?? process.env.PRINTER_DEFAULT ?? 'stdout';

const agent = new PrintAgent({
  url,
  token,
  version: VERSION,
  printerFor,
  // Impressora de rede com ?mac=... que mudou de IP é achada na rede e segue imprimindo.
  print: (spec, text) =>
    printResilient(spec, text, {
      onMoved: (from, to) =>
        console.warn(
          `A impressora mudou de IP: ${describePrinter(from)} → ${describePrinter(to)}. Atualize a variável.`,
        ),
    }),
  pollMs: Math.max(1000, Number(process.env.POLL_MS ?? 3000)),
});

agent.on('status', (s) => {
  if (s.state === 'online' && s.restaurant)
    console.log(`Conectado: ${s.restaurant} (agente "${s.agent}")`);
  if (s.state === 'offline')
    console.error(
      `Sem conexão com o Comandou (${s.error}); nova tentativa em ${s.retryIn / 1000}s`,
    );
  if (s.state === 'unauthorized') {
    console.error('Token recusado (agente desativado ou token trocado). Encerrando.');
    process.exit(2);
  }
});
agent.on('job', (j) => {
  const where = `${j.kind} → ${j.target} (${describePrinter(j.printer)})`;
  if (j.ok) console.log(`Impresso: ${where}`);
  else console.error(`Falha: ${where}: ${j.error}`);
});

console.log(`Comandou agente de impressão v${VERSION} → ${url}`);
agent.start();
