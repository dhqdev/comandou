---
titulo: Economizar papel
quando:
  - economizar papel
  - papel menor
  - está muito comprido
papeis: receipt, delivery_slip, kitchen_ticket
---
Tire o que sobra, sem perder o que importa: endereço e telefone da loja, traços repetidos do meio e,
só se a pessoa aceitar, o "NÃO É DOCUMENTO FISCAL". Conte o que tirou.

```json receipt
[{"tipo": "remover", "dado": "loja.endereco"}, {"tipo": "remover", "dado": "loja.telefone"}]
```

Traço do meio aparece várias vezes: para tirar um deles, use `trocar` com a linha de cima ou de
baixo junto (o trecho precisa aparecer uma vez só).
