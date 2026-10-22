# Análise inicial

Data: 2026-10-21 · Etapa 1 (investigação) do [roadmap](roadmap.md).

## 1. Repositório de destino: `dhqdev/pedemais`

| Item | Situação encontrada |
| --- | --- |
| Branch | `claude/project-thread-z1fy9o` (branch de trabalho), sem `main` remota publicada |
| Commits | Nenhum. Repositório vazio |
| Código, dependências, lockfiles | Nenhum |
| Docker, CI, testes, documentação | Nenhum |
| Licença | Nenhuma definida. **Pendente de decisão do dono** (ver [riscos](risks.md)) |

Conclusão: não havia trabalho a preservar. A estrutura foi criada do zero seguindo a referência do prompt mestre, sem módulos especulativos.

## 2. Repositório citado no prompt: `alextnetto/res`

O prompt mestre indicava `https://github.com/alextnetto/res` como repositório do projeto. Na investigação (clone somente leitura) ele se mostrou **outra coisa**, e o dono do projeto confirmou que o destino é `dhqdev/pedemais`.

| Item | Situação |
| --- | --- |
| O que é | **RES: Reverse Engineering SaaS**, uma skill/plugin de Claude Code (v0.4.0) para estudar um SaaS pelo navegador e gerar uma base de conhecimento (telas, regras, modelo de dados, tokens de design, barreiras de lançamento) |
| Licença | **MIT** (Copyright 2026 Alex Netto): permite uso, cópia e modificação mantendo o aviso de copyright |
| Stack | Markdown + scripts Node.js 22 sem dependências; Playwright só para testes |
| Histórico | 23 commits; exemplos de estudo de Pipedrive e ClickUp |

**Aproveitamento para o PedeMais**

- **Sim, como ferramenta de processo**, não como código do produto. É útil para estudar o sistema de referência (`dev.pedidoja.dev.br`) de forma organizada: inventário de telas, estados, regras com evidência e protocolo de segurança (não altera dados de produção, usa conta de teste).
- Requer um navegador controlado pelo agente (Claude in Chrome, Playwright MCP ou Chrome DevTools MCP) **na máquina do dono**, pois o sistema de referência não é acessível a partir do ambiente em nuvem (proxy bloqueia o domínio, ver bloqueios).
- Nada do RES foi copiado para este repositório. Se scripts dele forem incorporados no futuro, manter o aviso MIT.
- Recomendação: instalar no notebook do dono (`claude plugin marketplace add alextnetto/res` e `claude plugin install res@res`) e rodar o estudo do PedidoJá quando as credenciais de desenvolvimento forem liberadas. O resultado (`re-pedidoja/`) deve ser anexado em `docs/reference/`.

## 3. Sistema de referência

### Acesso

- `https://dev.pedidoja.dev.br/pdv/home`: **não acessado diretamente**. O ambiente de execução em nuvem recebe `403` do proxy para esse domínio e as credenciais ainda não foram fornecidas. **Pendente de validação.**
- Fonte usada: 11 capturas de tela enviadas pelo dono (PedidoJá v1.31.0 e Anota AI). Observações em [reference/observations.md](reference/observations.md).

### Indícios técnicos (pendentes de validação)

- A tela de login do PedidoJá usa o usuário `Administrator`, padrão do **Frappe Framework**. Isso é coerente com a regra do prompt de **não** usar Frappe: o PedeMais é uma reimplementação independente, não uma extensão.
- Há um "Agente v4.1.3" de impressão local com status por impressora (Caixa, Bar, Cozinha) e teste de impressão: confirma a necessidade de um agente local de impressão (Etapa 4).
- O caixa registra NFC-e por linha da linha do tempo ("Emitir NFC-e"), separando venda, suprimento e sangria por forma de pagamento.

## 4. Ambiente de execução desta entrega

| Recurso | Disponível? | Observação |
| --- | --- | --- |
| GitHub `dhqdev/pedemais` | Sim (escrita via branch + PR) | |
| PostgreSQL 16 local | Sim | usado nos testes de integração |
| Docker + Compose | Sim | build multiestágio verificado localmente |
| Infra de produção (Oracle Cloud, Swarm, Portainer, Traefik, `network_public`) | **Não** | nada foi alterado em produção. Stack preparada, **não implantada** |
| Sistema de referência | **Não** | bloqueado por proxy; sem credenciais |
| Focus NFe, WhatsApp, Backblaze | **Não** | fora do escopo da fundação |

## 5. Inventário entregue nesta etapa

Ver [README](../README.md) para a árvore de diretórios e [arquitetura](architecture.md) para o desenho. Resumo:

- `apps/api`: NestJS 11 + Drizzle + PostgreSQL com RLS, auth por sessão, provisionamento.
- `apps/web`: React 19 + Vite 7 + PWA, Design System próprio.
- `packages/shared`: dinheiro, slugs, papéis e permissões (compartilhado API/Web).
- `infrastructure/`: Dockerfiles, Nginx, Compose local com Traefik, stack Swarm.
- `.github/workflows/ci.yml`: lint/typecheck, testes com Postgres, build e imagens.
