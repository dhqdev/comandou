---
titulo: Quanto cobrar na porta
quando:
  - valor a cobrar bem grande
  - motoboy esquece de cobrar
  - pago bem visível
  - troco em destaque
papeis: delivery_slip
---
"A COBRAR" já sai em letra grande; pedido pago mostra o TOTAL grande e "PAGO - NÃO COBRAR". Para o
pago ficar ainda mais visível:

```json
{"tipo": "trocar", "de": "{{ \"*** PAGO - NÃO COBRAR ***\" | centro | negrito }}", "para": "{{ \"PAGO\" | grande: \"centro\" }}\n{{ \"NÃO COBRAR\" | centro | negrito }}"}
```

Troco em letra grande:

```json
{"tipo": "trocar", "de": "{{ \"LEVAR DE TROCO:\" | linha: pedido.levar_de_troco_formatado | negrito }}", "para": "{{ \"TROCO:\" | linha: pedido.levar_de_troco_formatado, 21 | grande }}"}
```
