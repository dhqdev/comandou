---
titulo: Total em destaque (ou menor)
quando:
  - total maior
  - total em destaque
  - valor final grande
  - total menor
papeis: receipt, delivery_slip
---
O total usa a largura 21 para caber na letra grande. Na Conferência ele já sai grande; na Via de
entrega o grande é o "A COBRAR" (ou o TOTAL, quando já está pago).

```liquid
{{ "TOTAL:" | linha: totais.total_formatado, 21 | grande }}
```

Total menor (só negrito, na largura toda):

```json receipt
{"tipo": "trocar", "de": "{{ \"TOTAL:\" | linha: totais.total_formatado, 21 | grande }}", "para": "{{ \"TOTAL:\" | linha: totais.total_formatado | negrito }}"}
```
