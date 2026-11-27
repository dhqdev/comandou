---
titulo: Logo do restaurante
quando:
  - coloque a logo
  - quero a logo no topo
  - tire a logo
  - a logo não aparece
papeis: receipt, delivery_slip, kitchen_ticket
---
A logo é sempre a primeira linha do papel, sozinha e centralizada. Ela vem da Loja online: se a
pessoa diz que a logo não sai, explique que precisa cadastrar a logo em Loja online (o modelo já
pede a logo quando ela existe). O rodapé do cupom fiscal não leva logo.

```json kitchen_ticket
{"tipo": "logo", "ligar": true}
```

```json receipt, delivery_slip
{"tipo": "logo", "ligar": false}
```
