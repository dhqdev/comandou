---
titulo: Tirar um dado do papel
quando:
  - tirar o cpf
  - tirar a data
  - tirar o telefone
  - tirar o nome do cliente
  - sem endereço da loja
  - tirar os adicionais
  - tirar não é documento fiscal
papeis: receipt, delivery_slip, kitchen_ticket
---
Use `remover` com o nome do dado. Ele tira a linha inteira e o `{% if %}` dela, sem deixar linha em
branco. Nomes de cada coisa:

- CPF/CNPJ do cliente: `pedido.cpf_cnpj` (só na Conferência de conta).
- Data e hora do pedido: `pedido.data` (Conferência e Via de entrega); na cozinha, `pedido.hora`.
- Nome do cliente: `pedido.cliente`. Telefone do cliente: `pedido.telefone`.
- Endereço de entrega: `pedido.endereco`. Endereço da loja: `loja.endereco`. Telefone da loja: `loja.telefone`.
- Tipo (Mesa 7, Delivery, Balcão): `pedido.local` (Conferência e cozinha) ou `pedido.canal` (Via de entrega).
- Observação do pedido: `pedido.observacao`. Observação do item: `item.observacao`.
- Adicionais dos itens (+ Bacon): `item.opcoes`.
- Textos fixos ("NÃO É DOCUMENTO FISCAL", "VIA DE ENTREGA"): `remover` com `texto`.

```json
{"tipo": "remover", "dado": "pedido.cliente"}
```

```json receipt
[{"tipo": "remover", "dado": "pedido.cpf_cnpj"}, {"tipo": "remover", "texto": "NÃO É DOCUMENTO FISCAL"}]
```

Se o dado não aparece no papel, não invente: diga que ele já não sai.
