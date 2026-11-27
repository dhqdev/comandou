# IA no Comandou

Onde a IA trabalha, que modelo cada parte usa e por quê, o que o assistente da equipe enxerga e
onde o restaurante e o Super Admin acompanham o uso. Revisão da 0.269 (pedido do David). Fotos dos
itens têm guia próprio: [ia-fotos.md](ia-fotos.md) (o 3D dos itens saiu na 0.272). A IA do WhatsApp está em
[whatsapp.md](whatsapp.md) e a esteira de chamados em [chamados.md](chamados.md).

## Onde a IA trabalha

Toda chamada passa pelo OpenRouter. O uso do restaurante entra em `ai_usage` (fonte em `source`) e
desconta do limite do mês; o uso do próprio Comandou entra em `platform_ai_usage` e nunca conta no
limite de restaurante nenhum.

| Parte (como aparece no Uso de IA) | O que faz | Modelo padrão | Fontes |
| --- | --- | --- | --- |
| Chat com a IA | Assistente da equipe (botão **IA** do topo) | conversa | `chat` |
| IA do WhatsApp | Responde os clientes, faz e cancela reservas | conversa | `whatsapp`, `agent_test` |
| Modelo de impressão | Monta o papel da comanda na conversa da tela Impressão (ações curtas + skills, sem raciocínio) | conversa | `print_template` |
| Fotos dos itens | Melhorar a foto (olhar), fundo limpo, foto criada e fotos da importação (fazer a foto) | olhar a foto + fazer a foto | `photo_tune`, `photo_clean`, `photo_create`, `menu_photo` |
| Cardápio e página | Importar o cardápio, achar o restaurante no Google e o texto da página | ler o cardápio (página: conversa) | `menu_import`, `menu_place`, `site_page` |
| Esteira de chamados (Comandou) | Os agentes da esteira, da triagem ao PR | o de Chamados › Configurar, vazio = conversa | `platform_ai_usage`, fonte `esteira` |
| Sites com IA (Comandou) | Sites criados pelo comandou.com | o de Sites com IA | `platform_ai_usage` |

Fonte nova no restaurante: entra numa parte de `AI_PARTS` e em `TENANT_SOURCE_LABEL`
(`apps/api/src/platform/ai-parts.ts`); o teste `ai-parts.test.ts` falha se faltar.

## Modelos e por quê

Os padrões e os preços de referência ficam em `apps/api/src/chat/ai-models.ts` (US$ por 1 milhão
de tokens, entrada / saída, conferidos no OpenRouter em novembro de 2026). O Super Admin troca cada
um em **Tokens de IA › Chaves e assistente**.

| Tarefa | Padrão | Preço | Por quê |
| --- | --- | --- | --- |
| Conversa (chat, WhatsApp, impressão, página) | DeepSeek V4 Flash (`deepseek/deepseek-v4-flash`) | 0,05 / 0,45 | O mais barato que conversa bem em português. A conversa gasta quase tudo em entrada (o guia do sistema vai em toda pergunta), e a entrada dele custa metade da do Gemini 2.5 Flash Lite; a parte repetida ainda sai pelo preço do cache |
| Reserva da conversa | Gemini 2.5 Flash Lite (`google/gemini-2.5-flash-lite`) | 0,10 / 0,40 | Outro provedor: se o DeepSeek cair ou recusar, o OpenRouter responde com ele na mesma chamada (`models: [principal, reserva]`) e o uso fica com o nome de quem respondeu (`servedModel`) |
| Olhar a foto (melhorar) | Gemini 2.5 Flash Lite | 0,10 / 0,40 | O mais barato que lê imagem e devolve JSON confiável |
| Fazer a foto (fundo limpo, criar) | GPT Image 2 (`openai/gpt-image-2`) | ~US$ 0,014 por foto | Boa qualidade pelo menor preço por imagem |
| Ler o cardápio e achar no Google | Gemini 2.5 Flash (`google/gemini-2.5-flash`) | 0,30 / 2,50 | Mais caro, mas é uma vez por restaurante, e errar o preço do cardápio inteiro sai mais caro |

**Raciocínio (0.274):** o DeepSeek V4 Flash pensa antes de responder por padrão, e o pensamento
conta no `max_tokens`. Para tarefa curta com formato fixo, `OpenRouterClient.complete` aceita
`reasoning: false` (manda `reasoning: { enabled: false }`; modelo que só responde pensando recebe o
pedido de novo sem o campo) e `fast` (`provider.sort: "throughput"`), e devolve `finish`
("length" = cortada no limite). A IA dos Modelos de impressão usa os dois: antes ela pensava e ainda
escrevia o modelo inteiro, e a resposta chegava cortada. Hoje ela responde ações curtas que o
servidor executa (`printing/template-actions.ts`, skills em `apps/api/assets/ai/impressao/`; guia
em [fiscal-guia.md](fiscal-guia.md), seção Modelos de impressão).

A migração 0129 trocou o padrão da conversa (quem estava no Gemini 2.5 Flash Lite padrão passou
para o DeepSeek; modelo escolhido à mão ficou) e criou `platform_ai_settings.import_model` (antes
fixo no `AI_IMPORT_MODEL` do servidor, que segue como reserva).

## O que o assistente da equipe enxerga

`apps/api/src/chat/ai.service.ts` monta duas mensagens de sistema a cada pergunta:

1. **Guia fixo** (`systemPrompt` de `ai-guide.ts`): regras, mapa de telas, seções da busca,
   impedimentos e os alvos que piscam. É o mesmo texto para todas as perguntas da mesma função,
   então o provedor reaproveita do cache (mais barato e mais rápido).
2. **Contexto da pergunta** (`contextPrompt`): quem pergunta, data e hora no fuso do restaurante, a
   tela aberta, o retrato da operação agora e o que a pergunta cita.

**Retrato da operação** (cada parte só para quem tem a permissão; se uma falhar, as outras seguem):

| Dado | Permissão |
| --- | --- |
| Caixa, comandas, pedidos em andamento, esgotados, loja online, nota fiscal, impressão, WhatsApp | todos |
| Vendas de hoje (pedidos, total, ticket médio, por tipo e origem) e de ontem (`salesLines` de `ai-snapshot.ts`); os 5 mais vendidos dos últimos 7 dias | `reports:read` ou `cash:close`; mais vendidos só com `reports:read` |
| Insumos no mínimo ou abaixo (`stockLines`) | `stock:read` |
| Reservas de hoje / entregas em preparo, prontas e na rua, e entregadores com o app aberto (`todayLines`) | `tables:operate` ou `settings:manage` / `delivery:manage` |
| Clientes (total, novos e aniversariantes de hoje) / equipe ativa por função / IA do WhatsApp ligada (`registryLines`) | `customers:read` / `users:manage` / `settings:manage` |
| Mudanças de custo recentes e os itens em que o custo mais pesa no preço | `stock:write` ou `reports:read` |
| Financeiro do mês (`financeSnapshot`) | `finance:read` |
| Uso de IA do mês contra o limite e a parte que mais usa | `plan:read` |

**O que a pergunta cita** (`lookup` + `ai-lookup.ts`): as palavras que importam ("X-Burguer",
"mesa 12", "insumo queijo"; palavras de tela e de pergunta ficam de fora) vão para a mesma busca do
topo (`runSearch` de `search/search.ts`), com as permissões de quem pergunta. Até 12 achados entram
no contexto com o link que leva até eles. Telefone, e-mail e CPF de cliente nunca vão para a IA: só
o nome que a pessoa citou.

## Link que leva e faz piscar

O assistente responde com links do próprio app. Com `?foco=<id>`, a tela rola até o elemento com
`data-search-id="<id>"` e ele pisca (`useSearchSpotlight` de `apps/web/src/lib/deep-link.ts`,
estilo `.cm-spotlight` em `lib/spotlight.css`, que vale também no Super Admin).

- Alvos que a IA conhece: as seções da busca do topo (`STATIC_ENTRIES`) e os botões e campos de
  `FOCUS_TARGETS` (`packages/shared/src/ai-focus.ts`: Nova venda, Loja aberta, Abrir e Fechar
  caixa, Sangria, Adicionar item, Importar com IA, Novo insumo, Nova pessoa, Nova reserva, cor da
  loja, taxa de entrega, pedido mínimo, chave Pix, CSC da nota, taxa de serviço, cada bloco da Conta
  e outros). Item achado pela busca leva até a linha dele.
- **Alvo novo:** um item em `FOCUS_TARGETS` + `data-search-id` (ou `searchId`/`focusId`) no
  elemento. O teste `apps/web/src/lib/ai-focus.test.ts` falha se o id não existir em nenhuma tela,
  e `ai-guide.test.ts` confere que todo caminho citado existe.
- Garçom, cozinha e entregador usam o app deles, sem essas telas: para eles o assistente não manda
  link, só explica.
- **Link garantido (0.271):** o modelo (o DeepSeek mais ainda) às vezes escreve o nome em negrito
  ou inventa caminho (`/assinatura`). Por isso o link não depende dele:
  - `packages/shared/src/ai-places.ts` junta telas, seções, atalhos e `FOCUS_TARGETS` em
    "lugares" (`appPlaces`). `placesFor(pergunta)` acha os que combinam com a pergunta, e eles
    entram no contexto em "Lugares para esta pergunta" com o link exato.
  - Na volta, `finishAnswer` (`ai-guide.ts`) passa `linkPlaces`: nome de lugar em negrito vira
    link, link com caminho que não existe é trocado pelo certo (ou vira negrito) e endereço do
    próprio Comandou vira caminho. Pergunta de "onde fica" sem link ganha o lugar mais provável no
    fim. O histórico (`linkHistory`) e a tela (`Markdown autoLink`) fazem o mesmo nas conversas
    antigas. Tudo pelas permissões de quem pergunta (`pathAllowed`).
  - `isKnownAppPath` só aceita subcaminho que existe de verdade (`SUBPATHS` em `nav-catalog.ts`):
    `/conta/assinatura` e `/financeiro/dre` são recusados.
  - Lugar novo que o assistente deve achar por outro nome: um apelido em `ALIASES` de
    `ai-places.ts`; o teste `ai-places.test.ts` cobre as perguntas do David.

## Problemas agora

`problems()` de `ai.service.ts` monta, a cada pergunta, a lista "Problemas agora" (do mais urgente,
cada um com a tela que resolve), com as consultas de `apps/api/src/chat/ai-problems.ts`. Cada parte
roda num SAVEPOINT próprio (`safely`): se falhar, as outras seguem. Gateway do WhatsApp e cobrança
têm 1,5 s no máximo.

| Problema | Permissão |
| --- | --- |
| Pedidos parados há mais de 3 h (os 3 mais antigos com link), esperando aceite, pedido de cancelamento, Pix enviado ou a devolver, concluídos sem pagamento (30 dias), negociações e lojas dos aplicativos, pagamentos online a devolver, conversas da loja sem resposta | `orders:manage` |
| Notas recusadas ou com erro (7 dias), paradas, contingência; certificado, CSC e homologação só para quem gerencia o fiscal | `fiscal:*` |
| Impressão sem app ligado, fila parada, falhas | `printing:manage` ou `orders:manage` |
| WhatsApp desconectado, mensagens que falharam | `messaging:manage` |
| Caixa aberto há mais de 18 h | caixa |
| Chamados de mesa, reservas para confirmar, cliente pedindo atendente na IA do WhatsApp | salão |
| Entregas na rua há mais de 90 min | `delivery:manage` |
| Avisos do sistema não lidos da própria pessoa | todos |
| Aviso de cobrança, uso de IA a partir de 80% do limite | `plan:read` |

Nada de telefone, e-mail ou CPF de cliente vai na lista; texto que vem de fora (motivo da SEFAZ,
erro do aplicativo) passa por `cleanText` e é dado, não instrução. A regra do guia manda começar
por essa lista quando perguntam de problema e avisar no fim um item `[urgente]` que a pessoa ainda
não viu. O que depende da Comandou (limite de IA do plano, por exemplo) o assistente explica e
mostra onde pedir: Conta › Falar com a Comandou para quem tem `plan:read`; para os outros, "o dono
ou o gerente fala com a Comandou".

## Onde ver o uso

- **Restaurante: Conta › Uso de IA** (`/conta/uso-ia`, `pages/AiUsagePage.tsx`; administrador e
  gerente, `plan:read`): quanto do limite do mês já foi, tokens e vezes no período (este mês, mês
  passado ou desde o início), as partes do sistema que mais usam, quem mais usou ("Atendimento
  automático (WhatsApp)" quando não há pessoa) e os últimos 30 dias. Sem valores em dinheiro. A
  API é `GET /chat/ai/usage?period=` (`chat/ai-usage.ts`); o cartão da Conta mostra a porcentagem
  do limite e a aba IA do chat tem o link **Ver onde usou**.
- **Super Admin › Tokens de IA › Uso dos restaurantes**: cada restaurante, com a pizza das partes.
- **Super Admin › Tokens de IA › Chaves e assistente › Modelos em uso**: um cartão por modelo, com
  para que serve (conversa, reserva, olhar a foto, fazer a foto, ler o cardápio, esteira, sites), o
  preço (do OpenRouter, ou o de referência), o porquê, o gasto, os tokens e as chamadas do mês e
  onde ele foi usado, separando restaurantes e sistema.
- **Super Admin › Chamados › Uso de IA**: o gasto da esteira, por agente, modelo e chamado
  ([chamados.md](chamados.md#uso-de-ia-da-esteira)).

## Chaves

Super Admin › Credenciais ([credenciais.md](credenciais.md)):

- **OpenRouter · chave dos restaurantes**: tudo o que o restaurante usa e os sites com IA.
- **OpenRouter · chave do sistema (esteira)**: a esteira de chamados e os testes do painel. Sem
  ela, o sistema usa a dos restaurantes, e Chamados e Tokens de IA avisam com o link que abre o
  cartão com o campo piscando. Cada uso grava qual chave pagou (`platform_ai_usage.key_kind`).
- **OpenRouter · chave de gerenciamento**: só lê o saldo da conta.
