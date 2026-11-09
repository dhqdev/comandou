# Comandou Impressão

Aplicativo que roda no computador do restaurante ligado às impressoras térmicas. Fica perto do
relógio (bandeja), em segundo plano, busca os trabalhos na API do restaurante (comandas de
cozinha, conferências de conta, páginas de teste), imprime e confirma.

**Por que precisa de um programa no computador?** O Comandou roda na nuvem e o navegador não
consegue mandar dados direto para uma impressora térmica USB ou de rede, nem imprimir sozinho
sem alguém clicar em "Imprimir". O aplicativo faz essa ponte: ele só **busca** trabalhos
(conexão de saída HTTPS), então não é preciso abrir portas no roteador.

- A fila fica no Comandou: se o computador ou a impressora caírem, os trabalhos esperam e voltam
  para a fila (até 5 tentativas). Falhas aparecem em **Impressão** no sistema e como aviso no
  computador.
- Comandas de cozinha saem sozinhas a cada pedido, uma por setor de produção, desde que exista um
  computador conectado. Sem ele, o pedido funciona normalmente e nada é enfileirado.
- Enquanto nenhuma impressora estiver escolhida no aplicativo, ele não pega trabalhos: eles
  esperam na fila.

## Para o restaurante

1. No Comandou, abra **Impressão** e clique em **Baixar para Windows** (ou macOS/Linux).
2. Instale (dois cliques). O aplicativo abre sozinho e passa a iniciar com o computador.
3. No painel, **Conectar computador** → **Abrir no aplicativo** (ou copie o código `CMD1-...` e
   cole no aplicativo).
4. Clique em **Adicionar impressora**, diga como ela está ligada, escolha a impressora,
   imprima um teste e salve. Opcional: uma impressora por setor (Bar, Chapa, Caixa...).

O botão **Ajuda** do aplicativo tem o passo a passo de cada tipo de ligação (Windows, macOS e
Linux) e os problemas mais comuns.

### Tipos de ligação

| Tipo | Como o aplicativo fala com ela | Impressora guardada como |
| --- | --- | --- |
| USB com driver (ou "Generic / Text Only"), compartilhada, paralela | spooler do Windows em modo RAW; CUPS (`lp -o raw`) no macOS/Linux | `printer:NOME` |
| Rede com cabo ou Wi-Fi | TCP na porta 9100 (RAW/JetDirect); **Procurar na rede** acha sozinho quem tem a 9100 aberta, sem imprimir nada | `tcp://IP:9100` |
| Bluetooth (perfil serial, SPP) | porta COM que o Windows cria ao parear; `/dev/cu.NOME` no macOS; `/dev/rfcomm0` no Linux | `serial:COM5` |
| Serial RS-232, USB-serial, COM virtual | .NET `SerialPort` no Windows; `stty` + escrita na porta no macOS/Linux | `serial:COM3?baud=19200` |
| USB direto, sem driver (Linux) | escreve em `/dev/usb/lp0` | `file:/dev/usb/lp0` |

Ajustes por impressora, no fim do texto: `papel=58` (bobina de 58 mm: fonte B, para caber as 42
colunas), `acentos=850` ou `acentos=ascii` (impressora que não tem a CP860), `baud=...` (serial).
A página de teste traz uma régua de 42 colunas e uma linha de acentos para conferir no papel.

Impressoras aceitas: térmicas ESC/POS (Elgin, Bematech, Epson, Daruma, Tanca, Knup, genéricas de
58/80 mm). Impressoras só BLE (Bluetooth Low Energy, sem perfil serial) não criam porta COM: use o
cabo USB delas.

Os instaladores não são assinados digitalmente ainda: no Windows, o SmartScreen pode pedir
"Mais informações → Executar assim mesmo"; no macOS, clique com o botão direito → Abrir.

## Desenvolvimento

```sh
cd tools/print-agent
npm ci
npm start          # abre o aplicativo
npm test           # testes (node --test)
npm run dist       # gera o instalador do sistema atual em dist/
```

- `core.mjs`: conexão com a API e laço de busca (usado pelo app e pela linha de comando).
- `printers.mjs`: saídas (`printer:NOME`, `tcp://IP:PORTA`, `serial:PORTA`, `file:/caminho`,
  `stdout`, `none`) e os ajustes (`?papel=58&acentos=850&baud=9600`).
- `devices.mjs`: descoberta (portas seriais e Bluetooth, USB direto, procura na rede).
- `escpos.mjs`: texto → ESC/POS (CP860, acentos do PT-BR).
- `desktop/`: aplicativo Electron (bandeja, janela de configuração, link
  `comandou-impressao://`).

Os instaladores são gerados pelo workflow **Aplicativo de impressão** a cada mudança nesta pasta
e publicados na Release fixa `impressora` do GitHub, sempre com os mesmos nomes de arquivo
(é para lá que o botão do painel aponta). Para hospedar em outro lugar, defina
`VITE_PRINT_AGENT_DOWNLOAD_URL` no build do web.

## Linha de comando (servidor sem tela)

Com Node.js 22:

```sh
COMANDOU_CODE=CMD1-... \
PRINTER_DEFAULT=tcp://192.168.0.50:9100 \
node agent.mjs
```

Outros exemplos: `PRINTER_BAR=serial:/dev/rfcomm0?papel=58`, `PRINTER_CHAPA=file:/dev/usb/lp0`,
`PRINTER_CAIXA=serial:/dev/ttyUSB0?baud=115200`.

Também aceita `COMANDOU_URL` + `COMANDOU_AGENT_TOKEN` no lugar do código. Uma impressora por
destino: `PRINTER_<DESTINO>` em maiúsculas, sem acentos, com `_` no lugar de espaços (ex.:
`PRINTER_BAR`, `PRINTER_CAIXA=printer:ELGIN_i9`). O que não tiver impressora própria vai para
`PRINTER_DEFAULT`. Para rodar como serviço no Linux, use systemd com `Restart=always` e as
variáveis num `EnvironmentFile` com permissão 600.

Guarde o código/token como segredo: quem tiver o código lê a fila de impressão do restaurante.
Se vazar, gere um novo no painel (o anterior para de funcionar na hora).

A conferência de conta impressa **não é documento fiscal**.
