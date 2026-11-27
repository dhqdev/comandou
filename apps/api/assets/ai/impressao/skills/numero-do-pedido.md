---
titulo: Número do pedido grande
quando:
  - número do pedido grande
  - quero ver o número de longe
  - destaque o número
papeis: receipt, delivery_slip, kitchen_ticket
---
Na cozinha o número já sai grande e centralizado. Na Conferência e na Via de entrega, troque a
linha "PEDIDO:" pelo número em letra grande (a variável `num` já tem o "#" na frente).

```json receipt, delivery_slip
{"tipo": "trocar", "de": "{{ \"PEDIDO:\" | campo: num | negrito }}", "para": "{{ \"PEDIDO \" | append: num | grande: \"centro\" }}"}
```
