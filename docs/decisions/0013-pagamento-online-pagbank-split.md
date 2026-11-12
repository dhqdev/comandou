# 0013 — Pagamento pelo app com PagBank Connect e split

**Situação:** aceita (2026-11-12)

## Contexto

O cardápio online só recebia Pix com comprovante (conferido pela equipe) e pagamento na entrega.
O dono da plataforma quer oferecer cartão e Pix pelo app, ganhar uma taxa pequena por pagamento e
**não** ficar com o dinheiro dos restaurantes (sem virar subadquirente nem custodiar saldo).

Opções avaliadas: subcontas do Asaas (já integrado para a mensalidade), split do PagBank e
gateways de marketplace. O Asaas exige conta principal de pessoa jurídica para criar subcontas e
não aceita débito pela API. O dono já tem conta no PagBank.

## Decisão

- **PagBank Connect**: cada restaurante conecta a própria conta PagBank (OAuth). O Comandou guarda
  o token dele cifrado e cria as cobranças **em nome do restaurante**, que é o vendedor principal.
- **Split com dois recebedores** em cada cobrança: o restaurante (`total − taxa`) e a conta da
  Comandou (`taxa`). O PagBank liquida cada parte direto na conta de cada um.
- O restaurante paga a taxa do PagBank e responde por chargeback (vendedor principal).
- Cartão cifrado no navegador com o SDK do PagBank e a chave pública da conta do restaurante: o
  servidor nunca vê o número do cartão (o CSP passa a permitir `assets.pagseguro.com.br`).
- Aviso do PagBank só dispara uma consulta; a situação vem sempre da API do PagBank.
- Pagamento aprovado vira pagamento normal do caixa (crédito/Pix), para fechamento, relatórios,
  NFC-e e estorno seguirem iguais. O estorno de um pagamento do app chama o PagBank antes.
- Sem conta conectada, o cardápio continua exatamente como antes (Pix com comprovante).

## Consequências

- O split precisa ser liberado pelo comercial do PagBank para a conta da Comandou.
- Algumas respostas do PagBank (troca de token, chave pública, id da conta conectada) não estão
  detalhadas na documentação: o cliente lê os campos de forma tolerante e o restaurante pode
  informar o id da conta (`ACCO_...`) à mão se ele não vier.
- Próximos passos: débito com 3DS, Pix automático na mesa, parcelamento.
