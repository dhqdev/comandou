---
titulo: Frase no fim do papel
quando:
  - volte sempre
  - mensagem de agradecimento
  - obrigado pela preferência
  - frase no final
  - confira seu pedido
papeis: todos
---
Use `adicionar_texto` com `onde: "fim"`: a frase entra centralizada antes do último traço.
Negrito é o normal para agradecimento; letra grande só se a pessoa pedir destaque (até 21 letras
por linha, frase maior quebra em mais linhas). Use a frase que a pessoa escreveu, do jeito dela.

```json
{"tipo": "adicionar_texto", "texto": "Obrigado e volte sempre!", "onde": "fim", "estilo": "negrito"}
```

Para tirar uma frase que já está no papel: `{"tipo": "remover", "texto": "volte sempre"}`.
