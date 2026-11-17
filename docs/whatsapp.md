# WhatsApp por QR Code (Baileys) com muitos restaurantes

Como o serviço `whatsapp-gateway` aguenta muitos restaurantes conectados e muitos clientes
conversando ao mesmo tempo, o que já está pronto e onde fica o limite.

## Como funciona

```
cliente no WhatsApp ──► gateway (1 socket por restaurante) ──► API (2 réplicas) ──► IA
                                  ▲                                 │
                                  └──────── envio / digitando ──────┘
```

- **Um socket por restaurante**, todos no mesmo processo Node. O WhatsApp só aceita uma conexão
  por aparelho vinculado: por isso o serviço tem **uma réplica só** (duas réplicas abririam duas
  conexões do mesmo número e o WhatsApp derrubaria uma com o código 440).
- As credenciais ficam cifradas em `comandou_wadata` (uma pasta por restaurante).

## O que já protege a operação com muitos clientes

| Situação | O que o gateway faz |
| --- | --- |
| Muitas mensagens chegando ao mesmo tempo | Uma fila **por conversa**: mensagens do mesmo cliente vão para a API uma de cada vez e na ordem; conversas diferentes andam em paralelo (até `INBOUND_CONCURRENCY`, padrão 64). Um restaurante lento não segura os outros. |
| Um restaurante inundado (spam, ataque) | Limite de 1000 mensagens esperando por restaurante e 20 000 no total; o excesso é descartado com aviso no log, sem afetar os outros. |
| API com 2 réplicas | A API só responde ao gateway depois de tratar a mensagem (até 45 s), então a ordem da conversa vale mesmo quando duas mensagens seguidas caem em réplicas diferentes. A mesma mensagem nunca é tratada duas vezes: a marca de "já recebida" fica no Redis e vale para todas as réplicas. |
| Rajada de envios do mesmo número | Ritmo mínimo de ~0,7 s (sorteado entre 0,56 e 0,84 s) entre mensagens do mesmo número, como gente digitando. Fila de mais de 15 s responde **429** e a API trata como "WhatsApp indisponível": a fila de avisos tenta de novo mais tarde, sem marcar como falha. |
| Queda da internet do servidor | Todas as sessões caem juntas. A religação é **sorteada** (até 5 s na detecção e metade sorteada na espera crescente), para não reconectar centenas de números no mesmo instante a partir do mesmo IP. |
| Reinício do serviço | As sessões salvas reabrem uma de cada vez, com 250 ms entre elas (300 restaurantes ≈ 75 s). |
| Conexão meio-aberta (NAT derrubou sem avisar) | Ping a cada 20 s; vigia a cada 15 s derruba e religa socket mudo há mais de 90 s; envio com a conexão parada manda um ping antes. |
| Erro de um restaurante | Exceção sem tratamento é registrada e não derruba o processo (o WhatsApp dos outros continua). |

## Monitorar

`GET /health` do gateway (rede interna) devolve só contagens:

```json
{
  "ok": true,
  "sessions": { "total": 120, "connected": 117, "connecting": 2, "qr": 0, "disconnected": 1, "logged_out": 0 },
  "memoryMb": 2100,
  "inbound": { "pending": 3, "inFlight": 3 }
}
```

`inbound.pending` subindo e não descendo = a API não está dando conta (ou está fora).

## Capacidade e quando crescer

O limite é **memória** de um processo só. Cada socket do Baileys guarda chaves de criptografia e
caches; a estimativa (não medida em produção ainda) é de 15 a 40 MB por restaurante conectado.

| Restaurantes conectados | Memória sugerida (`WA_MEMORY_LIMIT` / `WA_HEAP_MB`) |
| --- | --- |
| até 30 | 1536M / 1280 (padrão) |
| até 80 | 3G / 2600 |
| até 150 | 6G / 5200 |

Meça com `memoryMb` do `/health` e ajuste: deixe o `WA_HEAP_MB` uns 15% abaixo do limite do
contêiner. Passando de ~150 restaurantes num servidor, o caminho é **dividir em grupos**: vários
serviços `whatsapp-gateway-N`, cada um com seu volume e uma parte dos restaurantes (por exemplo,
pelo resto do id do restaurante), e a API escolhendo o endereço do grupo certo. Isso também
espalha os números por mais de um IP, o que reduz o risco de bloqueio.

## Risco de bloqueio (não oficial)

O Baileys não é a API oficial: o WhatsApp pode bloquear números que parecem robô. O gateway já
reduz o risco (ritmo de envio, "digitando..." antes da resposta da IA, "offline" fora das
respostas, religação espalhada), mas **não manda campanhas em massa**. Para disparos para quem
nunca falou com o restaurante, use a API oficial (Meta), que o Comandou também suporta.
