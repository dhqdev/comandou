# Item do cardápio em 3D

O cliente toca em **Ver em 3D** no cardápio online, gira o prato na tela e, no celular, vê o prato
em tamanho real em cima da mesa pela câmera (Android: Scene Viewer; iPhone: Quick Look).

O restaurante tem dois caminhos no cadastro do item (**Cardápio › Itens › item › Item em 3D**):

1. **Criar pelas fotos**: a foto do item e/ou até 4 fotos de ângulos diferentes. A IA cria o
   modelo e o servidor acerta o tamanho real (campo "Tamanho real do prato", padrão 25 cm).
2. **Enviar o arquivo escaneado**: o `.glb` (ou um `.zip` com o `.gltf`) que saiu de um aplicativo
   de celular, até 40 MB. O servidor deixa ele leve.

A lista de aplicativos e sites do mercado aparece na própria tela (fonte:
`apps/web/src/features/model3d-tools.ts`):

| Para | Opções |
| --- | --- |
| Escanear o prato com o celular | [Polycam](https://poly.cam), [Scaniverse](https://scaniverse.com), [KIRI Engine](https://www.kiriengine.app), [RealityScan](https://www.realityscan.com), [Luma AI](https://lumalabs.ai) |
| Criar com IA a partir de foto | [Meshy](https://www.meshy.ai), [Tripo](https://www.tripo3d.ai), [Hyper3D Rodin](https://hyper3d.ai), [Hunyuan3D](https://3d.hunyuan.tencent.com), [TripoSR](https://github.com/VAST-AI-Research/TripoSR) (código aberto, o nosso gerador local) |
| Conferir e ajustar o arquivo | [gltf.report](https://gltf.report), [Blender](https://www.blender.org) |

## Como funciona no servidor

```
tela do item ──► API ──► product_model_jobs (+ fotos/arquivo) ──► fila "model3d" (Redis)
                                                                     │
                       serviço model3d (mesma imagem da API) ◄───────┘
                         ├─ gerar: gerador local (model3d-ai) ou Meshy ─► GLB bruto
                         └─ otimizar: malha ≤ 120 mil triângulos, texturas WebP ≤ 2048 px,
                            Draco, prato em pé no chão e no tamanho real ─► product_models
```

- **Otimizador** (`apps/api/src/model3d/optimize.ts`): glTF-Transform + meshoptimizer + sharp,
  tudo dentro do Node, sem serviço de fora. Se o resultado passar de 12 MB, reduz as texturas
  para 1024 e depois 512. Escaneamentos já vêm em metros e mantêm a escala; o que vier com mais
  de 1,5 m ou menos de 3 cm (típico de IA) vai para o tamanho pedido ou 25 cm.
- **Fila própria**: um trabalho por vez, no serviço `model3d` (limite de 1 GB), longe das réplicas
  da API. Sem Redis (desenvolvimento), roda no próprio processo da API.
- **Um trabalho por item** em andamento. Trabalho parado há mais de 40 minutos (serviço fora do
  ar) aparece como falha e pode ser repetido. As fotos e o arquivo enviados são apagados quando o
  trabalho termina; fica só o modelo publicado.
- **Limite**: `MODEL3D_MONTHLY_GENERATIONS` criações por foto por restaurante por mês (padrão 10;
  falhas não contam). Enviar arquivo escaneado não tem limite.
- O `.usdz` antigo sai quando um modelo novo é publicado: o iPhone monta o dele a partir do GLB.

## Ligar "criar pelas fotos"

Escolha um gerador (variáveis em `deploy.env`, lidas pela API e pelo serviço `model3d`):

| Gerador | Como ligar | Custo e cuidado |
| --- | --- | --- |
| **Na nossa VM** (TripoSR) | `docker build -t comandou-model3d-ai:local infrastructure/model3d-ai` e deploy com `-c infrastructure/swarm/model3d-ai.yml` | Sem custo por modelo e as fotos não saem do servidor. Precisa de ~8 GB livres na hora de gerar; sem placa de vídeo leva de 30 s a 3 min. Cria por **uma** foto (as outras são ignoradas) e a cor fica nos vértices (menos nítida que textura). |
| **Meshy** (mercado) | `MESHY_API_KEY=msy_...` (chave em meshy.ai › API) | Textura melhor e aceita até 4 fotos. Cobra créditos por modelo; as fotos vão para o Meshy. |

`MODEL3D_PROVIDER=auto` (padrão) usa o gerador local se `MODEL3D_LOCAL_URL` existir, senão o
Meshy; `local`/`meshy` força um; `off` desliga só o "criar pelas fotos".

O gerador local segue um contrato simples (`POST /generate` com as fotos em base64, responde o
GLB), então dá para trocar o TripoSR por outro modelo aberto (Stable Fast 3D, Hunyuan3D) numa
máquina com placa de vídeo da rede interna, apontando `MODEL3D_LOCAL_URL` para ela.

> A imagem `infrastructure/model3d-ai` não foi construída nem executada no ambiente em que foi
> escrita (sem acesso ao Hugging Face). Confira o primeiro build no servidor.
