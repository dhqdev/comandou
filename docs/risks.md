# Riscos

Escala: **A**lto / **M**édio / **B**aixo (impacto × probabilidade).

| # | Risco | Nível | Mitigação atual | Próximo passo |
| --- | --- | --- | --- | --- |
| R1 | Vazamento entre restaurantes por bug de aplicação | A | RLS + papel sem bypass + FKs compostas + testes negativos | Exigir teste de isolamento em toda nova tabela (checklist de PR) |
| R2 | Uso acidental do papel dono pela API | A | API só recebe `DATABASE_URL` do papel `pedemais_app`; teste confere privilégios | Separar secrets no Swarm (já previsto) |
| R3 | Licença do PedeMais indefinida | M | Repositório privado | Dono decidir licença (proprietária recomendada) |
| R5 | Infra de produção não inspecionada (nomes de entrypoint/certresolver do Traefik, versão, nós ARM) | M | Stack parametrizada, nada implantado | Acesso ao Portainer para validar antes do primeiro deploy |
| R6 | Certificados: um por subdomínio via HTTP-01 esbarra no limite do Let's Encrypt (50/semana por domínio) | M | Stack pede `*.pedemais.com` | Configurar DNS-01 (wildcard) no Traefik existente |
| R7 | Compatibilidade ARM64 (Oracle Ampere) | B | Imagens `node:22-alpine` e `nginx-unprivileged` são multiarch; sem dependências nativas | Validar build `linux/arm64` no CI (job buildx já configurado) |
| R8 | Baileys (WhatsApp não oficial) pode ser bloqueado | A (Etapa 5) | — | Serviço isolado; avaliar WhatsApp Business Platform |
| R9 | Emissão fiscal incorreta | A (Etapa 5) | — | Homologação Focus NFe obrigatória; idempotência por referência |
| R10 | Operação offline gerar pedidos/pagamentos "fantasmas" | A | PWA não cacheia `/api`; UI só confirma após resposta | Fila offline só para ações não financeiras, com idempotency key |
| R11 | Concorrência em caixa/pagamentos | A (Etapa 3) | — | Idempotency keys + `FOR UPDATE` + testes concorrentes |
| R12 | Sessão roubada por XSS | M | Cookie HttpOnly, CSP restritiva no Nginx, React escapa conteúdo | Rotação de sessão em troca de papel; tela de sessões ativas |
| R13 | Força bruta no login | B | Limite por IP no Redis (todas as réplicas) + bloqueio temporário por conta (Etapa 7) | Avaliar CAPTCHA se houver abuso |
| R14 | Backups não validados em produção | M | pg_dump cifrado (age) → B2/S3, teste semanal de restauração, backup antes de cada deploy (Etapa 6) | Rodar contra o bucket real no primeiro deploy; guardar a identidade age fora do servidor |
| R15 | Rate limit em memória com várias réplicas | B | Contador no Redis desde a Etapa 7; sem Redis, volta ao contador local | — |
| R16 | Migração destrutiva em produção | A | Migrador falha se arquivo aplicado mudar; um arquivo por transação | Regra: só migrações aditivas; destrutivas com plano de rollback e autorização |

## LGPD

- Dados pessoais atuais: nome e e-mail de usuários, IP e user-agent em sessões/auditoria, e-mail em tentativas de login falhas.
- Minimização: logs HTTP não incluem corpo, cookies nem cabeçalho `Authorization`.
- Retenção: ver [operação](operations.md#retenção-de-dados-lgpd) (limpeza automática desde a Etapa 7).
- Pendentes: tela para exportação e exclusão a pedido do titular (hoje manual).
