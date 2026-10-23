<p align="center">
  <img src="apps/web/public/icons/icon-192.png" width="72" alt="Comandou" />
</p>

<h1 align="center">Comandou</h1>

<p align="center">
  Pedidos, salão, cozinha e caixa no mesmo lugar.<br />
  Sistema completo para restaurantes, vendido como serviço, com cardápio online próprio.
</p>

<p align="center">
  <img alt="versão" src="https://img.shields.io/badge/vers%C3%A3o-0.20-ea8a0b" />
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS-11-e0234e" />
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-16-336791" />
  <img alt="AMD64 e ARM64" src="https://img.shields.io/badge/imagens-amd64%20%7C%20arm64-555" />
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/pdv-escuro.webp" />
  <img alt="PDV com os pedidos chegando em tempo real" src="docs/assets/screens/pdv-claro.webp" />
</picture>

Cada restaurante tem o próprio endereço (`<restaurante>.comandou.com` ou um domínio próprio), o
próprio banco de dados e usa PDV, salão, cozinha, caixa, cardápio online, entregas, estoque,
financeiro, nota fiscal e avisos por WhatsApp. Funciona no computador e no celular (PWA), com tema
claro e escuro. Os dados de um restaurante nunca aparecem para outro.

> As telas abaixo são de um restaurante de exemplo (“Cantina da Vila”) rodando a versão 0.20.

## Operação do dia a dia

| Salão | Cozinha |
| --- | --- |
| ![Mapa de mesas livres, ocupadas e em pagamento](docs/assets/screens/salao-escuro.webp) | ![Fila da cozinha por setor: a fazer, preparando e pronto](docs/assets/screens/cozinha-claro.webp) |
| Mesas livres, ocupadas e em pagamento, comandas, QR Code de cada mesa e garçom pelo celular. | Fila por setor (cozinha, bar) em tempo real, com avanço por item ou pelo pedido inteiro. |
| **Caixa** | **Tema escuro** |
| ![Caixa aberto com valores esperados por forma de pagamento](docs/assets/screens/caixa-escuro.webp) | ![Cozinha no tema escuro](docs/assets/screens/cozinha-escuro.webp) |
| Abertura por terminal, suprimento, sangria e fechamento conferido por forma de pagamento. | Tema escuro em todas as telas, com o mesmo visual do claro. |

## Cardápio online

O cliente pede pelo celular ou pelo computador, cria conta, salva endereços e acompanha o pedido.
A loja é configurada pelo próprio restaurante: capa, logo, banners, destaques e horário.

| Loja no computador | Produtos e destaques |
| --- | --- |
| ![Loja online com capa, banner de promoção e categorias](docs/assets/screens/loja-cliente-claro.webp) | ![Destaques da casa e mais pedidos no tema escuro](docs/assets/screens/loja-cliente-produtos-escuro.webp) |
| **Configuração da loja (com prévia ao vivo)** | **Cardápio do restaurante** |
| ![Configuração da loja online com prévia do celular](docs/assets/screens/loja-online-claro.webp) | ![Cadastro de categorias, produtos com foto e adicionais](docs/assets/screens/cardapio-claro.webp) |

## No celular

O app instala na tela inicial e parece nativo: menu inferior grande, folhas que sobem de baixo e
cada função abre na sua tela (garçom no Salão, cozinha na Cozinha, entregador nas entregas).

<p align="center">
  <img src="docs/assets/screens/celular-pdv-claro.webp" width="19%" alt="PDV no celular" />
  <img src="docs/assets/screens/celular-salao-escuro.webp" width="19%" alt="Salão no celular, tema escuro" />
  <img src="docs/assets/screens/celular-cozinha-claro.webp" width="19%" alt="Cozinha no celular" />
  <img src="docs/assets/screens/celular-loja-claro.webp" width="19%" alt="Loja online no celular" />
  <img src="docs/assets/screens/celular-loja-escuro.webp" width="19%" alt="Loja online no celular, tema escuro" />
</p>

## Gestão

| Relatórios | Financeiro |
| --- | --- |
| ![Faturamento, recebimentos por forma e mais vendidos](docs/assets/screens/relatorios-claro.webp) | ![Contas a pagar e a receber](docs/assets/screens/financeiro-claro.webp) |
| **Estoque** | **Entregas** |
| ![Insumos com saldo, mínimo e custo médio](docs/assets/screens/estoque-escuro.webp) | ![Despacho de pedidos e entregadores na rua](docs/assets/screens/entregas-claro.webp) |
| **Equipe** | **Entrada** |
| ![Equipe com papéis e permissões](docs/assets/screens/equipe-claro.webp) | ![Tela de login do restaurante](docs/assets/screens/login-claro.webp) |

## Painel Super Admin

Onde o dono da plataforma cria restaurantes (cada um com banco próprio), acompanha uso, planos,
servidor, backups e auditoria. Entrada com senha e código do aplicativo autenticador.

<p align="center">
  <img src="docs/assets/screens/admin-restaurantes.webp" width="72%" alt="Lista de restaurantes no painel Super Admin" />
  <img src="docs/assets/screens/celular-admin.webp" width="20%" alt="Painel Super Admin no celular" />
</p>

## O que o sistema faz

| Área | Recursos |
| --- | --- |
| **Venda** | PDV com atalhos de teclado, adicionais e variações, pedidos de balcão, mesa, retirada e delivery, descontos com limite por papel, busca global (Ctrl+K) |
| **Salão** | Mapa de mesas e comandas, QR Code por mesa, garçom no celular (escaneia a mesa), pedir a conta, transferência, divisão sem perder centavo |
| **Cozinha** | Fila por setor de produção (KDS) em tempo real, avisos de atraso, avanço por item ou pedido |
| **Caixa** | Abertura por terminal, pagamentos com troco, estornos, sangria e suprimento, fechamento conferido |
| **Cardápio online** | Loja própria com capa, banners e destaques, contas de cliente com endereços e favoritos, acompanhamento do pedido, aceite manual ou automático |
| **Entregas** | Áreas desenhadas no mapa (bairro ou raio) com taxa e pedido mínimo, painel do entregador com login ou link, rastreio para o cliente |
| **Retaguarda** | Equipe e papéis, estoque com ficha técnica e custo médio, impressão local (agente ESC/POS), contas a pagar e receber, conciliação, relatórios |
| **Integrações** | NFC-e pela Focus NFe, avisos ao cliente pelo WhatsApp (QR Code ou API oficial), filas com novas tentativas |
| **Plataforma** | Painel Super Admin com dois fatores, banco de dados próprio por restaurante, planos e limites, domínio próprio, atualização pelo painel, backups cifrados no Backblaze B2 com teste de restauração |

O histórico de versões aparece no próprio sistema, na tela **Novidades**.

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
- **Segredos protegidos.** Tokens de integração, chaves de backup e sessões do WhatsApp cifrados no
  banco; senhas, cookies e tokens nunca vão para os logs.

Cada garantia tem testes automatizados: ver [docs/testing.md](docs/testing.md).

## Instalar em um servidor

```bash
curl -fsSL https://raw.githubusercontent.com/dhqdev/comandou/main/scripts/get.sh | sudo bash
```

AMD64 ou ARM64. O instalador prepara Docker/Swarm, HTTPS (Traefik) e os segredos; o Super Admin
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

Já vem um restaurante de demonstração completo, a **Casa Brasa**, em
http://exemplo.comandou.localhost:8080 (`dono@exemplo.comandou.local`, senha `comandou123`).
Em produção ele fica em `exemplo.<domínio>`; detalhes e como desligar em
[docs/install.md](docs/install.md#restaurante-de-demonstração).

Desenvolvimento sem Docker, testes e migrações: [docs/development.md](docs/development.md).

## Tecnologia

| Camada | Tecnologia |
| --- | --- |
| Backend | NestJS 11 + TypeScript (monólito modular), filas BullMQ, Socket.IO |
| Banco | PostgreSQL 16, um banco por restaurante, Row-Level Security, migrações SQL versionadas |
| Cache e filas | Redis |
| Frontend | React 19 + Vite 7 + TypeScript, Design System próprio (claro e escuro), PWA |
| Borda | Traefik (TLS e roteamento por endereço) → Nginx (arquivos estáticos) e NestJS (`/api`) |
| Infra | Docker, Compose (desenvolvimento), Swarm + Portainer (produção), imagens amd64 e arm64 |
| Qualidade | Vitest, supertest, Playwright, GitHub Actions (testes → imagens → Release) |

## Estrutura

```
apps/
  api/                API NestJS (auth, restaurantes, cardápio, pedidos, caixa, estoque,
                      entregas, loja online, financeiro, nota fiscal, WhatsApp, planos, plataforma)
    db/migrations/    SQL versionado (tabelas, RLS, permissões)
    test/             testes de integração e ponta a ponta
  web/                React + PWA (restaurante, cardápio online e painel Super Admin), e2e/ com Playwright
  whatsapp-gateway/   serviço separado do WhatsApp por QR Code
packages/
  shared/             regras comuns: dinheiro, papéis e permissões, planos, Novidades
tools/
  print-agent/        agente de impressão que roda no computador do restaurante
  load/               testes de carga
infrastructure/       Dockerfiles, Nginx, Traefik, stack do Swarm, backups, alertas
scripts/              instalação, checagem pré-produção, saúde
docs/                 arquitetura, decisões (ADR), operação, deploy, testes
```

## Documentação

- [Arquitetura](docs/architecture.md) · [Roadmap](docs/roadmap.md) · [Riscos](docs/risks.md) · [Decisões (ADR)](docs/decisions/README.md)
- [Desenvolvimento local](docs/development.md) · [Testes](docs/testing.md) · [Carga](docs/load-testing.md)
- [Instalação](docs/install.md) · [Deploy](docs/deploy.md) · [Operação](docs/operations.md) · [Backups e restauração](docs/backups.md) · [Segurança](docs/security.md)

## Licença

Código privado. A licença ainda não foi definida pelo dono do projeto.
