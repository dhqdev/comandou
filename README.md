<p align="center">
  <img src="apps/web/public/icons/icon-192.png" width="72" alt="Comandou" />
</p>

<h1 align="center">Comandou</h1>

<p align="center">
  Pedidos, salão, cozinha e caixa no mesmo lugar.<br />
  Sistema completo para restaurantes, vendido como serviço, com cardápio online próprio.
</p>

<p align="center">
  <img alt="versão" src="https://img.shields.io/badge/vers%C3%A3o-0.141-ea8a0b" />
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS-11-e0234e" />
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-16-336791" />
  <img alt="AMD64 e ARM64" src="https://img.shields.io/badge/imagens-amd64%20%7C%20arm64-555" />
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/pdv-escuro.webp" />
  <img alt="PDV com o salão em cima e os pedidos andando por coluna embaixo" src="docs/assets/screens/pdv-claro.webp" />
</picture>

Cada restaurante tem o próprio endereço (`<restaurante>.comandou.com` ou um domínio próprio), o
próprio banco de dados e usa PDV, salão, cozinha, caixa, cardápio online, entregas, estoque,
financeiro, nota fiscal e avisos por WhatsApp. Funciona no computador, no tablet e no celular
(instala como app), com tema claro e escuro, e continua vendendo sem internet: o que foi feito
offline sobe sozinho quando a conexão volta. Os dados de um restaurante nunca aparecem para outro.

> As telas abaixo são da antiga demonstração **Casa Brasa**, na versão 0.99. Hoje o sistema
> já vem com a **Fumaça Burger & Co.**, uma hamburgueria com um ano de uso e fotos reais.

## Operação do dia a dia

| Salão | Cozinha |
| --- | --- |
| ![Mapa do salão com mesas livres, ocupadas e pedindo a conta](docs/assets/screens/salao-claro.webp) | ![Fila da cozinha: a fazer, preparando e pronto, com o tempo de cada pedido](docs/assets/screens/cozinha-claro.webp) |
| Mapa por área (salão, varanda, mezanino), comandas, delivery e para levar, QR Code de cada mesa e garçom pelo celular. | Fila por setor em tempo real, com tempo de espera, aviso de cancelamento e avanço por item ou pelo pedido inteiro. |
| **Caixa** | **Pedidos** |
| ![Caixa aberto com a linha do tempo de vendas, suprimentos e sangrias](docs/assets/screens/caixa-escuro.webp) | ![Lista de pedidos do dia com status de operação e de pagamento](docs/assets/screens/pedidos-claro.webp) |
| Abertura por terminal, suprimento, sangria, emissão de NFC-e e fechamento conferido por forma de pagamento. | Todos os pedidos com filtros salvos, busca por cliente, telefone, mesa ou item, e o que falta receber. |

## Cardápio online

O cliente pede pelo celular ou pelo computador, cria conta, salva endereços, junta pontos e
acompanha o pedido. A loja é montada pelo próprio restaurante, com prévia ao vivo.

| Loja no computador | Tema escuro |
| --- | --- |
| ![Loja online com capa, banner da promoção, categorias e a sacola ao lado](docs/assets/screens/loja-cliente-claro.webp) | ![A mesma loja no tema escuro](docs/assets/screens/loja-cliente-escuro.webp) |
| **Configuração da loja (com prévia do celular)** | **Cardápio do restaurante** |
| ![Cores, letra e cantos da loja, com a prévia do celular ao lado](docs/assets/screens/loja-online-claro.webp) | ![Categorias e itens com foto, preço, situação e complementos](docs/assets/screens/cardapio-claro.webp) |

## No celular

O app instala na tela inicial e parece nativo: menu inferior grande, folhas que sobem de baixo e
cada função abre na sua tela (garçom no Salão, cozinha na Cozinha, entregador nas Entregas).

<p align="center">
  <img src="docs/assets/screens/celular-pdv-claro.webp" width="16%" alt="PDV no celular" />
  <img src="docs/assets/screens/celular-salao-escuro.webp" width="16%" alt="Salão no celular, tema escuro" />
  <img src="docs/assets/screens/celular-cozinha-claro.webp" width="16%" alt="Cozinha no celular" />
  <img src="docs/assets/screens/celular-entregas-claro.webp" width="16%" alt="Entregas no celular" />
  <img src="docs/assets/screens/celular-loja-claro.webp" width="16%" alt="Loja online no celular" />
  <img src="docs/assets/screens/celular-loja-escuro.webp" width="16%" alt="Loja online no celular, tema escuro" />
</p>

## Gestão

| Relatórios | Financeiro |
| --- | --- |
| ![Relatórios por assunto: vendas, perdas, cardápio, equipe e delivery](docs/assets/screens/relatorios-claro.webp) | ![Visão geral do financeiro: números do mês, saldo com previsão e leituras automáticas](docs/assets/screens/financeiro-claro.webp) |
| **Estoque** | **Entregas** |
| ![Insumos com saldo, mínimo, custo médio e quantos dias ainda duram](docs/assets/screens/estoque-escuro.webp) | ![Pedidos prontos para sair e entregadores na rua, no mapa](docs/assets/screens/entregas-claro.webp) |
| **Clientes** | **Equipe** |
| ![Clientes do cardápio online com pedidos, total gasto e último pedido](docs/assets/screens/clientes-claro.webp) | ![Equipe com o papel de cada pessoa](docs/assets/screens/equipe-claro.webp) |

<p align="center">
  <img src="docs/assets/screens/login-claro.webp" width="60%" alt="Tela de entrada do restaurante" />
</p>

## Painel Super Admin

Onde o dono da plataforma cria restaurantes (cada um com banco próprio), acompanha uso, planos,
cobrança, contratos, servidor e backups. Entrada com senha e código do aplicativo autenticador.
O menu fica em grupos (Clientes, Vendas, Financeiro, Sistema); o que aconteceu com cada
restaurante (plano, suspensão, acesso de suporte, contrato) fica na aba **Histórico** dele, e as
entradas no painel ficam em Conta › Registro do painel.

**Credenciais num lugar só.** A aba **Credenciais** junta todas as chaves, tokens e senhas que o
Comandou usa (Focus NFe, OpenRouter, Resend, Asaas, PagBank, Backblaze B2, GitHub, os aplicativos
de delivery e os segredos do servidor), diz o que falta para subir o sistema e traz o passo a passo com os links de cada uma.
As do painel se colam, testam e salvam ali mesmo, cifradas. Lista completa em
[docs/credenciais.md](docs/credenciais.md).

**E-mail próprio, sem n8n.** Todo e-mail do sistema (boas-vindas do teste, login e senha do
restaurante criado no painel, código de nova senha, avisos de fim do teste e de mensalidade,
contratos) sai pelo **Resend**, com o panda do Comandou e modo escuro, por uma fila que tenta de
novo sozinha. A aba **E-mail** tem a configuração do Resend, os **modelos** (prévia de cada
e-mail e os avisos automáticos) e o histórico de envios, com reenviar e cancelar. Toda tela de
entrada tem **Esqueci minha senha** com código por e-mail (o código vem no assunto: dá para
copiar da notificação). Passo a passo em [docs/email.md](docs/email.md).

<p align="center">
  <img src="docs/assets/screens/admin-restaurantes.webp" width="72%" alt="Lista de restaurantes no painel Super Admin" />
  <img src="docs/assets/screens/celular-admin.webp" width="20%" alt="Painel Super Admin no celular" />
</p>

## O que o sistema faz

| Área | Recursos |
| --- | --- |
| **Venda** | PDV com atalhos de teclado, adicionais e variações, pedidos de balcão, mesa, retirada e delivery, descontos com limite por papel, busca global (Ctrl+K) |
| **Salão** | Mapa de mesas e comandas, reservas em calendário (dia, semana, mês e lista, arrastar para remarcar), QR Code por mesa, garçom no celular (escaneia a mesa), pedir a conta, transferência, divisão sem perder centavo |
| **Cozinha** | Fila por setor de produção (KDS) em tempo real, avisos de atraso, avanço por item ou pedido |
| **Caixa** | Abertura por terminal, pagamentos com troco, estornos, sangria e suprimento, fechamento conferido que vai sozinho para o financeiro (taxa da maquininha e dia em que cai na conta) |
| **Cardápio online** | Loja própria com capa, banners e destaques, contas de cliente com endereços e favoritos, acompanhamento do pedido, aceite manual ou automático; pelo QR Code da mesa vira o cardápio da mesa, só para pedir e acompanhar (sem conversa, entrega, reserva ou conta) |
| **Entregas** | Áreas desenhadas no mapa (bairro ou raio) com taxa e pedido mínimo, painel do entregador com login ou link, rastreio para o cliente |
| **Retaguarda** | Equipe e papéis, estoque com ficha técnica e custo médio (mudou o preço de um insumo, o custo de todo preparo e item do cardápio que o usa é recalculado sozinho, com histórico e impacto na margem), relatórios com exportação para Excel |
| **Financeiro** | Visão geral com gráficos (saldo acumulado com previsão do fim do mês, despesas por grupo, formas de pagamento, dias da semana) e leituras automáticas do mês, contas a pagar e receber com plano de contas, fechamentos de caixa por dia, taxas e prazos das maquininhas, conciliação bancária pelo extrato OFX (os repasses casam sozinhos), DRE gerencial com CMV e indicadores (CMV, pessoal, ocupação, margem, ponto de equilíbrio), fluxo de caixa |
| **Agenda pessoal** | Agenda de cada pessoa da equipe no jeito do Google Agenda (dia, semana, mês e lista), tags próprias, arrastar para remarcar e lembrete pelo WhatsApp na hora escolhida. Vender fiado (PDV ou pedido) cria a cobrança na agenda com a tag Fiado e o WhatsApp do restaurante cobra o cliente no dia e hora combinados |
| **Impressão** | App Comandou Impressão (Windows x64/ARM, Mac Intel/Apple Silicon e Linux x64/ARM) para impressoras térmicas por rede/Wi-Fi (acha sozinho pela porta 9100 e Bonjour, e segue a impressora se o IP mudar), USB (instala sozinho a que está sem driver), serial e Bluetooth (pareado ou BLE sem parear), com a situação de cada impressora na tela e modelos de comanda editáveis |
| **Atendimento com IA** | IA que responde os clientes no WhatsApp com o cardápio liberado pelo gerente, faz e cancela reservas de mesa (grava só depois do SIM do cliente), manda o cardápio que o restaurante sobe (PDF ou fotos) e o calendário de reservas em PDF, lembra das conversas antigas e se protege de golpe, assunto indevido e tentativas de tirá-la do papel |
| **Aplicativos de delivery** | Pedidos do iFood, 99Food, Keeta, Rappi, aiqfome e de qualquer aplicativo Open Delivery chegam sozinhos e seguem o ciclo inteiro (aceitar, cozinha, pronto, saiu, entregue, cancelar com motivo) sem abrir o gestor de cada um; pago no app fora da gaveta, repasse na conciliação, nota com intermediador, aba **Aplicativos** em Pedidos e o relatório **Vendas por aplicativo**. iFood também com loja aberta/pausa, entregador, cardápio, repasse e avaliações. Guia em [docs/delivery-apps.md](docs/delivery-apps.md) |
| **Integrações** | NFC-e pela Focus NFe, avisos ao cliente pelo WhatsApp (QR Code ou API oficial), e-mail próprio pelo Resend, filas com novas tentativas |
| **Plataforma** | Painel Super Admin com dois fatores, banco de dados próprio por restaurante, planos e limites, domínio próprio, contratos com assinatura eletrônica, e-mail pelo Resend, site público com teste grátis, atualização pelo painel, backups cifrados no Backblaze B2 com teste de restauração |

O histórico de versões aparece no próprio sistema, na tela **Novidades** (tela **Conta**, aberta pelo nome no pé do menu).

## Garantias

- **Isolamento entre restaurantes.** Cada restaurante tem o próprio banco de dados. Dentro dele, o
  restaurante vem do endereço validado (nunca de um campo enviado pelo navegador) e todas as
  tabelas têm `tenant_id` com Row-Level Security no PostgreSQL: o banco recusa ler ou referenciar
  dados de outro restaurante mesmo se a aplicação errar.
- **Dinheiro sem arredondamento errado.** Valores em decimal (nunca ponto flutuante); pagamento,
  fechamento de pedido e de caixa com chave de idempotência; registro financeiro confirmado nunca
  é apagado, só estornado.
- **Confirmação só depois do servidor.** A tela não mostra pagamento ou operação de caixa como
  confirmados antes da resposta do backend; o aviso em tempo real é só um sinal.
- **Tudo ao vivo, com o sinal à vista.** Pedidos, cozinha, mesas, caixa, entregas, reservas,
  estoque, cardápio, financeiro, clientes, equipe, agenda e chats se atualizam sozinhos; as
  barrinhas de sinal no topo mostram se a conexão do aparelho está excelente, boa, lenta ou ruim.
- **Segredos protegidos.** Tokens de integração, chaves de backup e do e-mail e sessões do WhatsApp
  cifrados no banco; e-mail com senha ou código fica cifrado na fila e é apagado ao sair; senhas,
  cookies e tokens nunca vão para os logs.

Cada garantia tem testes automatizados: ver [docs/testing.md](docs/testing.md).

## Instalar em um servidor

Entre no servidor por SSH (Windows: PowerShell; Mac e Linux: Terminal) e rode:

```bash
curl -fsSL https://admin.comandou.com/instalar | sudo bash
```

Ubuntu ou Debian, AMD64 ou ARM64. Não precisa de token: o instalador vem da imagem pública. O instalador prepara Docker/Swarm, HTTPS (Traefik) e os segredos; o Super Admin
nasce do e-mail e da senha que você informa. Para atualizar, rode o mesmo comando ou use o botão
de atualização no painel. Detalhes, stack para Portainer e alternativas:
[docs/install.md](docs/install.md).

## Começar em desenvolvimento

```bash
cp .env.example .env    # troque as senhas
docker compose up -d --build
docker compose run --rm -e PROVISION_ADMIN_PASSWORD='uma-senha-forte' migrate \
  node dist/provisioning/provision-cli.js demo "Restaurante Demo" dono@demo.local "Dono Demo"
# abra http://demo.comandou.localhost:8080
```

Já vem um restaurante de demonstração completo, a hamburgueria **Fumaça Burger & Co.**, em
http://fumaca.comandou.localhost:8080 (`dono@fumaca.comandou.local`, senha `comandou123`).
Em produção ela fica em `fumaca.<domínio>`; detalhes e como desligar em
[docs/install.md](docs/install.md#restaurante-de-demonstração).

Desenvolvimento sem Docker, testes e migrações: [docs/development.md](docs/development.md).
Quem trabalha com o Claude Code no projeto tem as skills em [`.claude/skills`](.claude/skills)
(padrão visual e o mapa do projeto, mantidos junto com o código). Para o site público há também a
[Impeccable](https://github.com/pbakaus/impeccable) (Apache 2.0), skill de design de páginas de
venda, usada como régua de acabamento abaixo da `comandou-design`.

## Tecnologia

| Camada | Tecnologia |
| --- | --- |
| Backend | NestJS 11 + TypeScript (monólito modular), filas BullMQ, Socket.IO |
| Banco | PostgreSQL 16, um banco por restaurante, Row-Level Security, migrações SQL versionadas |
| Cache e filas | Redis |
| E-mail | Fila própria no PostgreSQL com novas tentativas; envio pela API do Resend |
| Frontend | React 19 + Vite 7 + TypeScript, Design System próprio (claro e escuro), PWA; site público sempre claro, com rolagem suave (Lenis) e animações do React Bits e do Uiverse |
| Borda | Traefik (TLS e roteamento por endereço) → Nginx (arquivos estáticos) e NestJS (`/api`) |
| Infra | Docker, Compose (desenvolvimento), Swarm + Portainer (produção), imagens amd64 e arm64 |
| Qualidade | Vitest, supertest, Playwright, GitHub Actions (testes → imagens → Release) |

## Estrutura

```
apps/
  api/                API NestJS (auth, restaurantes, cardápio, pedidos, caixa, estoque,
                      entregas, loja online, financeiro, nota fiscal, WhatsApp, planos, plataforma,
                      e-mail)
    db/migrations/    SQL versionado (tabelas, RLS, permissões)
    test/             testes de integração e ponta a ponta
  web/                React + PWA (restaurante, cardápio online e painel Super Admin), e2e/ com Playwright
  whatsapp-gateway/   serviço separado do WhatsApp por QR Code
packages/
  shared/             regras comuns: dinheiro, papéis e permissões, planos, Novidades
tools/
  print-agent/        agente de impressão que roda no computador do restaurante
  load/               testes de carga
infrastructure/       Dockerfiles, Nginx, Traefik, stack do Swarm, backups e alertas
scripts/              instalação, checagem pré-produção, saúde
docs/                 arquitetura, decisões (ADR), operação, deploy, testes
```

## Documentação

- [Arquitetura](docs/architecture.md) · [Roadmap](docs/roadmap.md) · [Riscos](docs/risks.md) · [Decisões (ADR)](docs/decisions/README.md)
- [Desenvolvimento local](docs/development.md) · [Testes](docs/testing.md) · [Carga](docs/load-testing.md)
- [Financeiro: fechamento, conciliação e DRE](docs/financeiro.md) · [Site público e teste grátis](docs/site.md) · [E-mail (Resend)](docs/email.md) · [Contratos](docs/contratos.md) · [Cobrança](docs/cobranca.md) · [WhatsApp com muitos restaurantes](docs/whatsapp.md) · [Agenda](docs/agenda.md)
- [Aplicativos de delivery: como ligar e problemas comuns](docs/delivery-apps.md) · [Desenho dos canais (ADR 0015)](docs/decisions/0015-canais-de-delivery.md)
- [Credenciais: todas as chaves e como conseguir](docs/credenciais.md) · [Instalação](docs/install.md) · [Deploy](docs/deploy.md) · [Operação](docs/operations.md) · [Backups e restauração](docs/backups.md) · [Segurança](docs/security.md) · [Auditoria de 2026-11](docs/auditoria-2026-11.md) · [CrowdSec](docs/crowdsec.md)

## Licença

Código privado. A licença ainda não foi definida pelo dono do projeto.
