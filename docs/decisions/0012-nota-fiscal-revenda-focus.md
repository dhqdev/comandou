# 0012 — Nota fiscal no modo revenda da Focus NFe

**Situação:** aceita (2026-10-26)

## Contexto

A NFC-e já saía pela Focus NFe (decisão 0008), mas cada restaurante precisava ter conta própria na
Focus e colar o token no painel. Para oferecer a nota fiscal como parte do Comandou, o lojista não
deve precisar contratar nem entender a Focus.

## Decisão

O Comandou opera como **revenda/parceiro** da Focus NFe com uma conta só:

- O **token master** da conta fica em Super Admin › Credenciais (cifrado, tabela
  `platform_credentials`, desde a 0.161.0). Sem ele no painel, vale a variável antiga
  `FOCUS_NFE_MASTER_TOKEN` do servidor.
- Em Nota fiscal → Configuração, o lojista faz o **cadastro guiado** em 3 etapas: dados da empresa
  (com busca pelo CNPJ), certificado digital **A1** (.pfx + senha) e **CSC** da NFC-e por ambiente.
- A API chama `POST /v2/empresas` (ou `PUT /v2/empresas/{id}`) com o token master. A Focus valida o
  certificado e devolve `token_homologacao` e `token_producao` da empresa.
- Guardamos só o id da empresa na Focus, os dados cadastrais e os **dois tokens cifrados**
  (AES-256-GCM, contexto por restaurante e ambiente). **Certificado, senha e CSC nunca vão para o
  banco nem para a auditoria**: passam direto para a Focus.
- Cada nota usa o token do ambiente em que foi criada. Produção continua exigindo o dono, a
  confirmação explícita e, no modo revenda, o CSC de produção.
- A validade do certificado aparece no painel, com aviso a partir de 30 dias do vencimento.
- O modo antigo (**token próprio**) continua disponível para quem já tem conta na Focus, e é o único
  quando o servidor não tem token master.

## Consequências

- A Focus cobra o Comandou por empresa/nota; o preço ao lojista sai do plano (`feature_fiscal`).
- Trocar o token master não afeta as empresas já cadastradas (cada uma tem os seus tokens).
- Próximos passos possíveis: NF-e (modelo 55) para venda a empresas, webhook da Focus no lugar da
  consulta por fila e alerta automático de certificado vencendo.
