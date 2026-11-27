---
titulo: Destacar uma linha de dado
quando:
  - cliente em negrito
  - destacar o nome do cliente
  - data em negrito
  - deixar uma linha maior
papeis: receipt, delivery_slip, kitchen_ticket
---
Linha de rótulo e valor (`campo`): negrito é só pôr `| negrito` no fim. Letra grande: o valor sozinho
em `grande` (o rótulo cabe na linha de cima, em negrito), porque o campo tem 42 colunas e a letra
grande só 21.

```json
{"tipo": "trocar", "de": "{{ \"CLIENTE:\" | campo: pedido.cliente }}", "para": "{{ \"CLIENTE:\" | campo: pedido.cliente | negrito }}"}
```

```liquid
{{ "CLIENTE:" | negrito }}
{{ pedido.cliente | upcase | grande }}
```
