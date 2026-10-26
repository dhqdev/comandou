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
4. Escolha a impressora principal (USB instalada no Windows ou impressora de rede pelo IP) e
   clique em **Testar**. Opcional: uma impressora por setor (Bar, Chapa, Caixa...).

Impressoras aceitas: térmicas ESC/POS (Elgin, Bematech, Epson, Daruma, Tanca, genéricas de 58/80
mm) instaladas no sistema (USB: no Windows vai direto para o spooler em modo RAW; no macOS/Linux
pelo CUPS) ou em rede na porta 9100.

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
- `printers.mjs`: saídas (`tcp://IP:PORTA`, `printer:NOME`, `file:/caminho`, `stdout`, `none`).
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

Também aceita `COMANDOU_URL` + `COMANDOU_AGENT_TOKEN` no lugar do código. Uma impressora por
destino: `PRINTER_<DESTINO>` em maiúsculas, sem acentos, com `_` no lugar de espaços (ex.:
`PRINTER_BAR`, `PRINTER_CAIXA=printer:ELGIN_i9`). O que não tiver impressora própria vai para
`PRINTER_DEFAULT`. Para rodar como serviço no Linux, use systemd com `Restart=always` e as
variáveis num `EnvironmentFile` com permissão 600.

Guarde o código/token como segredo: quem tiver o código lê a fila de impressão do restaurante.
Se vazar, gere um novo no painel (o anterior para de funcionar na hora).

A conferência de conta impressa **não é documento fiscal**.
