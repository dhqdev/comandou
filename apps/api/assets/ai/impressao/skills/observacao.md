---
titulo: Observação do pedido em destaque
quando:
  - observação em destaque
  - ninguém lê a observação
  - observação maior
papeis: receipt, delivery_slip, kitchen_ticket
---
Título da observação em letra grande e o texto em negrito. A observação já vem logo depois dos
dados do pedido, antes dos itens.

```json
{"tipo": "trocar", "de": "{{ \"OBSERVAÇÃO:\" | negrito }}", "para": "{{ \"OBSERVAÇÃO\" | grande: \"centro\" }}"}
```

```json receipt, delivery_slip
{"tipo": "trocar", "de": "{{ pedido.observacao | quebra }}", "para": "{{ pedido.observacao | quebra | negrito }}"}
```
