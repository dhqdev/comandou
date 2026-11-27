---
titulo: Senha do Wi-Fi
quando:
  - senha do wifi
  - coloca o wi-fi
  - rede e senha da internet
papeis: todos
---
Duas linhas centralizadas no fim: o nome da rede normal e a senha em negrito. Use o nome da rede e
a senha que a pessoa disse. Se ela não disse os dois, pergunte (acoes: []) antes de mudar.

```json
[
  {"tipo": "adicionar_texto", "texto": "Wi-Fi: MinhaRede", "onde": "fim"},
  {"tipo": "adicionar_texto", "texto": "Senha: cliente123", "onde": "fim", "estilo": "negrito"}
]
```
