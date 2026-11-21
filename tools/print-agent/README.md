# Comandou Impressão

Aplicativo que roda no computador do restaurante ligado às impressoras térmicas. Fica perto do
relógio (bandeja), em segundo plano, busca os trabalhos na API do restaurante (comandas de
cozinha, conferências de conta, páginas de teste), imprime e confirma.

**Por que precisa de um programa no computador?** O Comandou roda na nuvem e o navegador não
consegue mandar dados direto para uma impressora térmica USB ou de rede, nem imprimir sozinho
sem alguém clicar em "Imprimir". O aplicativo faz essa ponte: ele só **busca** trabalhos
(conexão de saída HTTPS), então não é preciso abrir portas no roteador.

- A fila fica no Comandou: se o computador ou a impressora caírem, os trabalhos esperam e voltam
  para a fila (até 5 tentativas, com espera de 10 s, 20 s, 40 s... entre elas). Falhas aparecem
  em **Impressão** no sistema e como aviso no computador.
- **Sem cópias repetidas (1.6.0):** o aplicativo pega um trabalho por vez e desiste de cada
  impressão em 60 s (`PRINT_TIMEOUT`, bem abaixo do prazo de 150 s do servidor). Falha que pode
  ter saído (o Windows aceitou a folha, a impressora de rede recebeu e não fechou, ou demorou
  demais) vai como `sent: true` e **não** volta sozinha para a fila: a pessoa confere e toca em
  "Imprimir de novo". Impressora comum (folha) com 3 ou mais comandas paradas na fila do Windows,
  ou com erro, não recebe mais nenhuma até voltar (`spoolBacklog`).
- **Tirar da fila** na tela Impressão vale também para o que o computador já pegou (ele não
  confirma mais) e **Limpar fila** / **Limpar fila do Windows** apaga os documentos "Comandou"
  da fila do sistema (`purgeSpool`, só os nossos; os de outros programas ficam). O pedido vem no
  heartbeat (`purge`) e o aplicativo confirma no seguinte (`purgedAt`).
- **Atualizar (1.7.0):** `desktop/updater.mjs` lê `versao.json` da Release "impressora" (o
  workflow `print-agent.yml` gera junto com os instaladores) ao abrir a janela, ao voltar da suspensão e a cada hora. Com
  versão nova, o botão fixo **Buscar atualização** do topo vira **Atualizar para a X** (também na bandeja). Windows: baixa o
  `Comandou-Impressao-Setup.exe`, roda com `/S --force-run` (instala em silêncio e reabre) e
  fecha; Linux (AppImage): troca o próprio arquivo e reabre; macOS: abre o download do `.dmg`.
  Quem está na 1.6.0 ou antes instala a 1.7.0 na mão uma última vez.
- A tela do aplicativo não tem mais histórico (fica na tela Impressão do Comandou): de um lado as
  impressoras deste computador, do outro onde cada coisa imprime, com **Desconectar** em cada
  impressora escolhida (a principal para de imprimir; o setor volta a usar a principal).
- **Impressora desligada (1.8.0):** a cada 30 s, sem imprimir, o aplicativo abre e fecha uma conexão com a impressora (IP da porta ou endereço WSD do campo Local, com o IP atual achado pelo MAC na tabela ARP). Duas conferências seguidas sem resposta viram aviso no aplicativo, na bandeja e no sistema (`state: 'off'` no heartbeat). USB instalada só é detectada quando o Windows a marca como offline. O rodapé tem **Receber notificações**.
- **Saúde do computador (1.10.0, só Windows):** `desktop/care.mjs` faz uma checagem que não muda nada (disco, memória, antivírus, reinício pendente) e, depois de a pessoa escolher, limpa temporários e caches com mais de 24 h e roda DISM, SFC e `chkdsk /scan` com permissão do Windows. Nunca toca em Documentos, Downloads, Área de Trabalho, Lixeira, senhas, histórico ou favoritos, e não segue junctions.
- A tela Impressão também tira uma impressora do aplicativo (`remove` no heartbeat, confirmado
  em `removed`) e exclui o computador.
- Jato de tinta ou laser escolhida como térmica pela rede (texto cru na porta 9100, que não sai
  ou sai uma folha por tentativa) é trocada sozinha, ao abrir, pela mesma impressora instalada no
  Windows em modo folha, quando o nome dela tem o fim do MAC (ex.: `EPSON17C57B (L4260 Series)`,
  `installedTwinOf`).
- Comandas de cozinha saem sozinhas a cada pedido, uma por setor de produção, desde que exista um
  computador conectado. Sem ele, o pedido funciona normalmente e nada é enfileirado.
- Enquanto nenhuma impressora estiver escolhida no aplicativo, ele não pega trabalhos: eles
  esperam na fila.

## Para o restaurante

1. No Comandou, abra **Impressão** e clique em **Baixar para Windows** (ou macOS/Linux).
2. Instale (dois cliques). O aplicativo abre sozinho e passa a iniciar com o computador.
3. No painel, **Conectar computador** → **Abrir no aplicativo** (ou copie o código `CMD1-...` e
   cole no aplicativo).
4. Ao abrir, o aplicativo já procura todas as impressoras (instaladas, cabo USB, Bluetooth e
   rede/Wi-Fi, ao mesmo tempo). Clique em **Usar** na sua e em **Testar**. Opcional: **Usar em…**
   um setor (Bar, Chapa, Caixa...). Não apareceu? **Adicionar manualmente** abre o passo a passo
   antigo, por tipo de ligação.

O botão **Ajuda** do aplicativo tem o passo a passo de cada tipo de ligação (Windows, macOS e
Linux) e os problemas mais comuns.

### Tipos de ligação

| Tipo | Como o aplicativo acha | Como o aplicativo fala com ela | Impressora guardada como |
| --- | --- | --- | --- |
| USB com driver (ou "Generic / Text Only"), compartilhada, paralela | impressoras instaladas no sistema | spooler do Windows em modo RAW; CUPS (`lp -o raw`) no macOS/Linux | `printer:NOME` |
| USB **sem driver** | Windows: porta `USB001…` sem impressora; macOS/Linux: backend `usb` do CUPS | botão **Instalar**: cria a fila com o "Generic / Text Only" (Windows, pede permissão) ou RAW (`lpadmin -m raw`, pede a senha) | `printer:Comandou_MODELO` |
| Rede com cabo ou Wi-Fi | **Procurar na rede**: porta 9100 em toda a rede local (até /22) + Bonjour/mDNS (`_pdl-datastream`, `_printer`, `_ipp`), sem imprimir nada; **Testar este IP** descobre a porta (9100–9102, 515, 631) | TCP na porta 9100 (RAW/JetDirect) | `tcp://IP:9100?mac=…` |
| Bluetooth pareado (perfil serial, SPP) | porta COM do Windows, `/dev/cu.NOME` no macOS, `/dev/rfcommN` no Linux; pareada **sem porta** aparece com **Criar porta** (Windows abre a tela Portas COM; Linux cria o rfcomm e deixa fixo com systemd) | porta serial | `serial:COM5` |
| Bluetooth **BLE** (portáteis sem porta COM) | **Procurar por BLE** (Web Bluetooth do Chromium, sem parear no sistema) | escreve na característica de escrita (serviços `18f0`, `ff00`, `ffe0`, `fff0`, `ae30`, ISSC…) em pedaços de 20 bytes; religa sozinho pelo endereço salvo | `ble:ENDEREÇO` |
| Serial RS-232, USB-serial, COM virtual | portas seriais do sistema | .NET `SerialPort` no Windows; `stty` + escrita na porta no macOS/Linux | `serial:COM3?baud=19200` |
| USB direto, sem driver (Linux) | `/dev/usb/lp*` | escreve no aparelho | `file:/dev/usb/lp0` |
| Impressora **comum** (jato de tinta, laser: Epson EcoTank, HP, Canon, Brother…) | impressoras instaladas no sistema cujo nome/driver não é de térmica (`looksLikeReceipt` em `printers.mjs`; no Windows o driver vem do `Get-Printer`) | o texto vira uma folha HTML com letra de largura fixa e sai pelo driver, sem janela (`webContents.print({ silent: true })`, `desktop/document.mjs`); o QR Code da NFC-e vira o endereço por escrito | `printer:NOME?modo=folha` |

Ajustes por impressora, no fim do texto: `modo=folha` (impressora comum, só no aplicativo com
tela; na tela de ajustes é o "Tipo de impressora"), `papel=58` (bobina de 58 mm: fonte B, para caber as 42
colunas), `acentos=850` ou `acentos=ascii` (impressora que não tem a CP860), `baud=...` (serial),
`mac=00-11-22-33-44-55` (rede: guardado sozinho ao escolher da lista ou testar o IP).
A página de teste traz uma régua de 42 colunas e uma linha de acentos para conferir no papel.

**IP que mudou:** impressora de rede com `mac=` que deixa de responder é procurada pela tabela ARP
e, se preciso, por uma nova varredura; achou, imprime no IP novo, salva a troca em todos os setores
e avisa para reservar o IP no roteador (`printResilient` em `devices.mjs`; a linha de comando
também usa, só avisando no log).

**Situação das impressoras:** a cada 2 minutos (e ao abrir a janela) o aplicativo confere, sem
imprimir, se cada impressora está ao alcance (rede responde, porta COM existe, fila ainda instalada,
cabo USB ligado) e mostra uma bolinha verde ou vermelha com o motivo. Em rede, **Ver situação**
pergunta à impressora (DLE EOT do ESC/POS, não imprime) se falta papel, se a tampa está aberta ou se
há erro. BLE não é conferido em segundo plano (gastaria a bateria da impressora).

Impressoras aceitas: térmicas ESC/POS (Elgin, Bematech, Epson, Daruma, Tanca, Knup, genéricas de
58/80 mm) e, em folha, qualquer impressora comum instalada no computador.

**Tipo e detalhes de cada impressora:** `kinds.mjs` reconhece o tipo pelo nome, pelo driver, pelo
modelo e pela linguagem que a impressora informa (campo `CMD` do IEEE 1284): térmica de cupom
(ESC/POS direto), jato de tinta, laser, matricial e etiqueta (essas pelo driver, em folha) e virtual
(PDF/OneNote, aparece mas não serve para a comanda). Instaladas: no Windows, `Get-Printer`,
`Get-PrinterPort`, `Get-PrinterDriver`, `Win32_Printer` e `Get-PrintJob` dão driver, fabricante,
porta e o IP dela, compartilhamento, padrão, situação, fila, resolução, cor, frente e verso e papéis;
no macOS/Linux, os atributos do CUPS (`device-uri`, `printer-state-reasons`, `marker-levels`) e
`lpstat -o`. Rede: `ipp.mjs` (Get-Printer-Attributes na porta 631: modelo, situação, tinta,
papéis) e `snmp.mjs` (SNMP v2c "public": série, contador de páginas, erros e toner pela Printer-MIB),
juntos em `inspect.mjs`, só perguntando (nada é impresso). Impressora só IPP (jato/laser sem 9100)
aparece pelo Bonjour e **Instalar** cria a fila no sistema pelo IPP (`Add-Printer -IppURL` no
Windows, `lpadmin -m everywhere` no macOS/Linux, sem driver do fabricante), que passa a imprimir em
folha. Sem IPP, **Adicionar no sistema** abre a tela de impressoras do sistema.

**Cara do restaurante:** o heartbeat devolve `brand` (cor, tema claro/escuro/automático e ícone, os
mesmos do sistema). A tela usa a cor do restaurante (ajustada para ter contraste) e o tema; o ícone é
baixado, desenhado em PNG na janela escondida (`renderIcon` em `desktop/ble/ble.js`) e salvo em
`marca/` na pasta do aplicativo, para abrir já com ele (`desktop/brand.mjs`). Vale para a janela, a
barra de tarefas, a bandeja (com a bolinha: verde conectado, amarela tentando, vermelha código
recusado, cinza parado; no Windows também uma bolinha sobre o ícone da barra de tarefas) e os
atalhos do Windows (área de trabalho e Iniciar). O instalador é o mesmo para todos: a cara muda
quando o aplicativo conecta.

**Impressoras no sistema:** o heartbeat também manda as impressoras escolhidas (`printers`: setor,
nome e tipo, nunca o endereço), que aparecem em **Impressão › Computadores conectados**; o sistema
mostra o ícone de impressora no topo com a mesma bolinha.

**Sistemas:** Windows 10/11 em Intel, AMD ou ARM (um instalador com as duas versões), macOS Intel e
Apple Silicon (o macOS pede permissão de Bluetooth e de rede local na primeira vez) e Linux x64 ou
ARM (AppImage; o de ARM é `Comandou-Impressao-arm64.AppImage` na mesma Release). No Linux, o BLE do
Chromium precisa do BlueZ e liga a opção `enable-experimental-web-platform-features` sozinho.

Os instaladores não são assinados digitalmente ainda: no Windows, o SmartScreen pode pedir
"Mais informações → Executar assim mesmo"; no macOS, clique com o botão direito → Abrir.

## Desenvolvimento

```sh
cd tools/print-agent
npm ci
npm start          # abre o aplicativo
npm test           # testes (node --test; sem impressora: rede, mDNS, ARP, USB e Bluetooth simulados)
npm run dist       # gera o instalador do sistema atual em dist/
```

- `core.mjs`: conexão com a API e laço de busca (usado pelo app e pela linha de comando).
- `printers.mjs`: saídas (`printer:NOME`, `tcp://IP:PORTA`, `serial:PORTA`, `file:/caminho`,
  `stdout`, `none`) e os ajustes (`?papel=58&acentos=850&baud=9600`).
- `devices.mjs`: descoberta (portas seriais e Bluetooth, USB direto, procura na rede com MAC),
  situação ESC/POS pela rede e a impressão que segue o IP novo (`printResilient`).
- `mdns.mjs`: Bonjour/mDNS sem dependências (pergunta e leitura dos pacotes).
- `usb.mjs`: impressora USB sem driver (lista e instala a fila RAW em cada sistema).
- `bluetooth.mjs`: pareadas sem porta serial e o `rfcomm bind` fixo do Linux.
- `desktop/ble.mjs` + `desktop/ble/`: Bluetooth BLE pela janela escondida (Web Bluetooth); a
  escolha do aparelho é feita no evento `select-bluetooth-device`.
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
