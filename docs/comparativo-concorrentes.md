# Comandou × concorrentes (novembro de 2026)

Levantamento feito em 19 e 20/11/2026 com fontes oficiais (site, central de ajuda, página de preços,
loja de aplicativos) e imprensa recente. O lado do Comandou foi conferido **no código** (versão 0.204),
não só na documentação. Onde a fonte do concorrente não falava do recurso, ficou `?` (não quer dizer
que não exista: vale confirmar numa demonstração antes de usar o dado num argumento de venda).

## Quem é quem

| Sistema | Para quem | Preço público | Observação de mercado |
| --- | --- | --- | --- |
| **Saipos** | Pequeno e médio, delivery e salão, franquias | a partir de R$ 240,79/mês | Diz ter 25 mil restaurantes; recebeu investimento do iFood (abr/2025); comprou a Levilo |
| **Anota AI** | Atendimento e vendas pelo WhatsApp (delivery) | não divulga (terceiros: R$ 249,99 a R$ 389,99) | Do iFood desde 2022; carro-chefe é o robô que fecha pedido |
| **Consumer + MenuDino** | PDV para pequeno e médio | grátis (até 200 pedidos) a R$ 269,90/mês | Funciona sem internet; TEF próprio; MenuDino é o delivery próprio |
| **Goomer** | Pedido digital (QR, tablet, totem, delivery) sobre o PDV de terceiros | grátis a R$ 299,90/mês | Não tem fiscal, estoque nem financeiro |
| **Cardápio Web** | Cardápio digital que virou PDV | R$ 169,99 a R$ 624,93/mês | Marketing mais completo entre os cardápios; MCP para IA |
| **Yooga** | ERP de pequenos e franquias | não divulga | Pagamentos próprios; comprou a Kuppi (WhatsApp) |
| **Colibri** | Médio e grande, redes | não divulga | Da RS Solutions (era da NCR); comprou Qnow (fila/reserva) e Cannoli (CRM) |
| **TOTVS Food / Chef** | Redes médias e grandes | não divulga | Dona da Linx desde 27/02/2026 |
| **Linx Degust / Menew** | Redes de fast-food (Degust), pequeno e médio (Menew) | não divulga | Agora TOTVS |
| **GrandChef** | Pequeno restaurante | R$ 199,90 a R$ 299,90/mês | NFC-e e NF-e ainda "em breve" |
| **iFood (ferramentas)** | Lojas do marketplace | Gestor grátis | Gestor de Pedidos, iFood Pago/Maquinona, Na Mesa, Totem, Toqan (IA) |
| **Kyte** | Pequeno varejo em geral | grátis a R$ 99,90/mês | Não é focado em restaurante |

Mudanças de mercado que pesam na conversa com o cliente: **São Paulo encerrou o SAT em 01/01/2026**
(Portaria SRE 79/2024) e o **Ceará está descontinuando o MF-e** (Decreto 36.417/2025): NFC-e virou o
padrão, e o Comandou já emite NFC-e e NF-e pela Focus. A Uber Eats não opera mais delivery de
restaurante no Brasil.

## Matriz de funcionalidades

Legenda: ✅ tem · ◐ tem em parte · ❌ não tem · `ᵖ` só por parceiro · `?` não confirmado.
Colunas: SAI Saipos · ANO Anota AI · CON Consumer · GOO Goomer · CW Cardápio Web · YOO Yooga ·
COL Colibri · GC GrandChef · IFD iFood.

| Funcionalidade | **Comandou** | SAI | ANO | CON | GOO | CW | YOO | COL | GC | IFD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PDV / caixa com abertura, sangria e fechamento | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ? |
| Mesas e comandas | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| App do garçom | ✅ | ✅ | ✅ | ✅ | ? | ? | ✅ | ✅ | ✅ | ❌ |
| QR Code na mesa (cliente pede) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ? | ? | ✅ | ✅ |
| Comanda por cartão ou pulseira | ◐ | ? | ✅ | ? | ? | ? | ? | ? | ? | ❌ |
| Divisão de conta | ✅ | ✅ | ? | ✅ | ? | ? | ? | ? | ✅ | ? |
| Taxa de serviço | ✅ | ✅ | ? | ? | ? | ? | ? | ? | ✅ | ? |
| Couvert artístico | ❌ | ✅ | ? | ? | ? | ? | ? | ? | ? | ? |
| Tela da cozinha (KDS) por setor | ✅ | ✅ | ? | ✅ | ✅ | ✅ | ✅ | ✅ | ? | ❌ |
| Impressão por setor | ✅ | ✅ | ? | ✅ | ? | ✅ | ? | ? | ? | ❌ |
| Totem de autoatendimento | ❌ | ✅ | ? | ✅ | ✅ | ✅ | ✅ | ✅ | ? | ✅ |
| Cardápio online próprio, sem comissão | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| Áreas de entrega no mapa (raio/bairro) | ✅ | ✅ | ? | ✅ | ✅ | ✅ | ? | ? | ? | ❌ |
| App do entregador | ✅ | ✅ | ? | ✅ | ? | ✅ | ✅ | ? | ? | ❌ |
| Rastreio do entregador ao vivo | ✅ | ? | ? | ✅ | ? | ? | ? | ? | ? | ◐ |
| Roteirização / agrupar entregas | ❌ | ✅ | ? | ✅ | ? | ✅ | ? | ? | ? | ❌ |
| Pedido agendado no cardápio próprio | ◐ | ✅ | ? | ✅ | ✅ | ✅ | ? | ? | ? | ? |
| iFood | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 99Food · Keeta · Rappi · aiqfome | ✅ | ✅ | ◐ | ◐ | ? | ◐ | ? | ◐ | ◐ | ❌ |
| Open Delivery (qualquer aplicativo) | ✅ | ? | ᵖ | ? | ? | ✅ | ? | ? | ? | ? |
| Repasse dos aplicativos na conciliação | ✅ | ✅ | ? | ? | ❌ | ? | ? | ? | ? | ? |
| Avisos de status pelo WhatsApp | ✅ | ✅ | ✅ | ✅ | ? | ✅ | ? | ? | ✅ | ? |
| IA no WhatsApp (atende, cardápio, reserva) | ✅ | ✅ | ✅ | ✅ | ? | ✅ | ? | ? | ? | ❌ |
| Robô que **fecha o pedido** no WhatsApp | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ? | ✅ | ❌ |
| Cupons de desconto | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ? | ? | ✅ | ✅ |
| Cashback | ❌ | ✅ | ✅ | ✅ | ? | ✅ | ? | ✅ | ? | ✅ |
| Fidelidade por pontos ou carimbos | ✅ | ? | ✅ | ✅ | ✅ | ✅ | ? | ✅ | ✅ | ? |
| Campanhas em massa (WhatsApp/e-mail) | ❌ | ✅ | ? | ✅ | ◐ | ✅ | ✅ | ✅ | ? | ? |
| Recuperar clientes que pararam de comprar | ◐ | ✅ | ✅ | ✅ | ? | ✅ | ? | ? | ✅ | ? |
| CRM com segmentos (RFV) | ◐ | ✅ | ? | ? | ✅ | ✅ | ✅ | ✅ | ? | ? |
| Pixel da Meta / Google Analytics | ◐ | ✅ | ✅ | ? | ✅ | ✅ | ? | ? | ✅ | ❌ |
| Pix automático e cartão no cardápio | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ? | ✅ | ✅ |
| Maquininha integrada (TEF / Smart POS) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| NFC-e | ✅ | ✅ | ᵖ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| NF-e (e notas recebidas) | ✅ | ✅ | ᵖ | ✅ | ❌ | ? | ? | ? | ❌ | ❌ |
| Estoque com ficha técnica | ✅ | ✅ | ? | ✅ | ❌ | ✅ | ✅ | ? | ? | ❌ |
| CMV e preço sugerido | ✅ | ✅ | ? | ? | ❌ | ✅ | ✅ | ? | ? | ❌ |
| Lote e validade | ✅ | ? | ? | ? | ❌ | ? | ? | ? | ? | ❌ |
| Pedido de compra e cadastro de fornecedores | ❌ | ✅ | ? | ✅ | ❌ | ? | ? | ? | ? | ❌ |
| Contas a pagar/receber e fluxo de caixa | ✅ | ✅ | ? | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| DRE gerencial | ✅ | ✅ | ? | ? | ❌ | ? | ✅ | ? | ✅ | ❌ |
| Conciliação bancária (OFX) | ✅ | ✅ | ? | ? | ❌ | ? | ✅ | ✅ | ? | ? |
| Relatórios com exportação | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Várias lojas / franquia | ❌ | ✅ | ✅ | ✅ | ? | ✅ | ✅ | ✅ | ? | ? |
| Reservas de mesa | ✅ | ? | ? | ? | ? | ? | ? | ✅ | ? | ✅ |
| Fila de espera | ❌ | ? | ? | ? | ? | ? | ? | ✅ | ? | ? |
| Avaliação do cliente | ◐ | ? | ✅ | ? | ✅ | ✅ | ? | ? | ? | ✅ |
| Balança (venda por quilo) | ◐ | ✅ | ? | ✅ | ? | ✅ | ✅ | ? | ✅ | ❌ |
| Funciona sem internet | ◐ | ◐ | ? | ✅ | ? | ? | ? | ✅ | ✅ | ❌ |
| Aplicativo instalável (PWA) | ✅ | ? | ? | ? | ? | ? | ? | ? | ✅ | ? |
| API pública | ❌ | ✅ | ? | ? | ? | ✅ | ? | ? | ? | ? |
| Assistente de IA da equipe | ✅ | ✅ | ? | ? | ? | ✅ | ✅ | ? | ? | ✅ |
| Agenda da equipe e cobrança de fiado | ✅ | ◐ | ? | ◐ | ? | ◐ | ? | ? | ? | ? |
| Super Admin multi-restaurante (revenda) | ✅ | — | — | — | — | — | — | — | — | — |

Notas do lado do Comandou:
- **Comanda por cartão ou pulseira (◐):** comanda avulsa com número automático e nome; não lê um
  cartão pré-impresso.
- **Pedido agendado (◐):** só os que chegam agendados do iFood e do Open Delivery (o cardápio próprio
  não agenda; ver "O que entrou depois deste levantamento").
- **Recuperar clientes (◐):** existe o relatório "Pararam de comprar", sem envio.
- **CRM (◐):** ficha do cliente com histórico e gráficos, filtros prontos; sem segmentos próprios.
- **Pixel (◐):** pixel próprio com UTM e funil nos relatórios; não manda para a Meta nem para o Google.
- **Avaliação (◐):** nota por item no cardápio; sem pesquisa pós-pedido.
- **Balança (◐):** venda por peso com tara, digitada; não lê a balança.
- **Sem internet (◐):** consultas e lançamentos ficam numa fila e sobem depois; pagamento, caixa,
  nota fiscal e login precisam de internet.

## Onde o Comandou está na frente

- **Financeiro de verdade:** DRE com CMV e indicadores, conciliação bancária por OFX com casamento
  automático, recebíveis das maquininhas com taxa e prazo e o repasse dos aplicativos conciliado. Só a
  Saipos e a Yooga chegam perto.
- **Aplicativos de delivery:** iFood completo (pedido, cardápio, pausa, entregador, repasse,
  avaliações, negociação) mais Keeta, 99Food, Rappi, aiqfome e **qualquer aplicativo Open Delivery**.
  Open Delivery nativo só foi confirmado na Cardápio Web.
- **Estoque com custo em cascata:** mudou o preço de um insumo, o custo de todo preparo e item é
  recalculado, com histórico e impacto na margem; lotes e validade.
- **Reservas com IA no WhatsApp:** a IA reserva e cancela (só depois do SIM do cliente). Reserva só
  foi confirmada na Colibri (Qnow) e no iFood.
- **Segurança e plataforma:** banco próprio por restaurante, RLS no PostgreSQL, Super Admin com dois
  fatores, backups cifrados com teste de restauração, versão por restaurante.
- **Rastreio ao vivo e app do entregador próprio**, confirmado só na Consumer.

## O que falta, em ordem de peso na venda

1. **Maquininha integrada (TEF / Smart POS).** 10 de 12 concorrentes têm. Exige contrato e SDK de cada
   adquirente (Stone, Cielo, PagBank, Rede, Getnet) e homologação: não dá para fazer sem as contas.
2. **Cupons, cashback e campanhas.** O pacote de marketing que Anota AI, Saipos, Consumer e Cardápio
   Web vendem. Cupons e recuperar clientes são o começo natural.
3. **Robô que fecha o pedido no WhatsApp.** A IA do Comandou conversa, reserva e manda o link do
   cardápio, mas não monta o pedido. É exatamente o produto da Anota AI.
4. **Várias lojas / franquia.** Visão consolidada e cardápio central para quem tem mais de uma unidade.
5. **Totem de autoatendimento.** Depende de maquininha integrada para pagar no totem.
6. **Pedido agendado no cardápio próprio** e **produtos por horário** (café da manhã, happy hour).
7. **Retaguarda:** pedido de compra, cadastro de fornecedores e entrada da NF-e recebida no estoque.
8. **Salão:** couvert, comanda por cartão/pulseira e fila de espera.
9. **Conectividade:** Pixel da Meta, Google Analytics/GTM e API pública com webhooks.

## O que entrou depois deste levantamento

Ver a tela **Novidades** e `packages/shared/src/releases.ts`; esta seção lista o que foi feito a partir
das lacunas acima.

## Fontes principais

- Saipos: https://saipos.com/planos-e-precos · https://saipos.com/sistema/saipos-bot · https://saipos.com/sistema/saipos-crm · https://saipos.com/integracoes · https://intercom.help/meajuda-saipos/pt-BR/
- Anota AI: https://anota.ai/ · https://anota.ai/home/funcionalidade/atendente-virtual/ · https://anota.ai/home/funcionalidade/marketing-para-restaurante/ · https://anota.ai/home/funcionalidade/salao-de-restaurante/
- Consumer e MenuDino: https://consumer.com.br/recursos · https://loja.consumer.com.br · https://www.menudino.com/
- Goomer: https://goomer.com.br/planos · https://goomer.com.br/integracoes
- Cardápio Web: https://www.cardapioweb.com/ · https://www.cardapioweb.com/integracoes/ · https://ajuda.cardapioweb.com/
- Yooga: https://saibamais.yooga.com.br/para/completo · https://ajuda.yooga.com.br/
- Colibri: https://www.colibri.com.br/solucoes · https://startups.com.br/negocios/colibri-faz-novas-aquisicoes-e-amplia-ecossistema-para-restaurantes/
- TOTVS / Linx: https://www.menew.com.br/ · https://borainvestir.b3.com.br/noticias/empresas/totvs-compra-a-linx-da-stone-em-negocio-de-r-305-bilhoes/
- GrandChef: https://www.grandchef.com.br/
- iFood: https://gironews.com/food-service/ifood-lanca-toqan-ia-para-gestao-de-restaurantes/ · https://gironews.com/food-service/ifood-lanca-funcionalidade-de-reserva-de-mesa/
- Kyte: https://www.kyteapp.com/pt/planos

Limites: TOTVS e Linx têm pouca documentação pública; preços de Anota AI, Yooga, Colibri, TOTVS e Linx
não são publicados (os da Anota AI vêm de terceiros).
