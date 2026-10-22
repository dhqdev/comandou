# Agente de impressão do PedeMais

Programa pequeno, sem dependências, que roda no computador do restaurante ligado às
impressoras térmicas. Ele busca os trabalhos na API do restaurante (comandas de cozinha,
conferências de conta, páginas de teste), imprime e confirma.

- A fila fica no PedeMais: se o computador ou a impressora caírem, os trabalhos esperam e
  voltam para a fila (até 5 tentativas). Falhas aparecem em **Impressão** no sistema.
- O agente só **busca** trabalhos (conexão de saída HTTPS). Não é preciso abrir portas.
- Comandas de cozinha saem sozinhas a cada pedido, uma por setor de produção, desde que exista
  um agente ativo. Sem agente, o pedido funciona normalmente e nada é enfileirado.

## Requisitos

- Node.js 22 ou mais novo.
- Impressora térmica ESC/POS em rede (porta 9100) ou acessível como arquivo/dispositivo
  (ex.: `/dev/usb/lp0` no Linux).

## Instalação

1. No PedeMais, abra **Impressão → Adicionar agente**. Copie o token (`pma_...`): ele aparece
   uma única vez. Se perder, gere um novo token (o anterior para de funcionar).
2. Copie a pasta `tools/print-agent` para o computador.
3. Rode:

```sh
PEDEMAIS_URL=https://SEU-RESTAURANTE.pedemais.com \
PEDEMAIS_AGENT_TOKEN=pma_... \
PRINTER_DEFAULT=tcp://192.168.0.50:9100 \
node agent.mjs
```

No Windows (PowerShell):

```powershell
$env:PEDEMAIS_URL="https://SEU-RESTAURANTE.pedemais.com"
$env:PEDEMAIS_AGENT_TOKEN="pma_..."
$env:PRINTER_DEFAULT="tcp://192.168.0.50:9100"
node agent.mjs
```

Guarde o token como segredo: quem tiver o token lê a fila de impressão do restaurante.
Não coloque o token em repositório nem em print de tela.

## Uma impressora por setor

Cada trabalho tem um **destino**: o nome do setor de produção (ex.: "Chapa", "Bar") ou
"Caixa" para conferências. Configure `PRINTER_<DESTINO>` em maiúsculas, sem acentos, com `_`
no lugar de espaços. O que não tiver impressora própria vai para `PRINTER_DEFAULT`.

```sh
PRINTER_DEFAULT=tcp://192.168.0.50:9100   # cozinha
PRINTER_BAR=tcp://192.168.0.51:9100       # setor "Bar"
PRINTER_CAIXA=file:/dev/usb/lp0           # conferência de conta no caixa
```

Formatos aceitos: `tcp://IP:PORTA`, `file:/caminho` e `stdout` (mostra no terminal; útil para
testar sem impressora).

## Rodar como serviço

- **Linux (systemd)**: crie `/etc/systemd/system/pedemais-print.service` com
  `ExecStart=/usr/bin/node /opt/pedemais/print-agent/agent.mjs`, as variáveis em
  `EnvironmentFile=/etc/pedemais-print.env` (permissão 600) e `Restart=always`.
- **Windows**: use o Agendador de Tarefas ("Ao iniciar") ou um gerenciador de serviços como o
  NSSM, com as variáveis acima.

## Testes

```sh
node --test tools/print-agent/escpos.test.mjs
```

A conferência de conta impressa **não é documento fiscal** (NFC-e fica para a etapa fiscal).
