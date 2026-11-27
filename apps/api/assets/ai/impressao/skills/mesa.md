---
titulo: Mesa ou tipo do pedido em destaque
quando:
  - mesa em destaque
  - mostrar de qual mesa é bem grande
  - delivery bem visível
papeis: receipt, kitchen_ticket
---
`pedido.local` é "Mesa 7", "Comanda 12", "Delivery", "Retirada" ou "Balcão". Na cozinha ele já sai
grande e centralizado logo depois do número. Na Conferência de conta, troque a linha "TIPO:" pelo
local em letra grande:

```json receipt
{"tipo": "trocar", "de": "{{ \"TIPO:\" | campo: pedido.local | upcase }}", "para": "{{ pedido.local | upcase | grande: \"centro\" }}"}
```
