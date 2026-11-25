# Item em 3D pela foto

Você recebe UMA foto de um item do cardápio (prato, porção, bebida, lanche, sobremesa) e o nome
dele. O servidor do Comandou vai montar um modelo 3D simples com a própria foto: um prato ou
tigela visto de cima, ou um copo/lanche girado em volta do eixo. Sua tarefa é só ler a forma.

Responda SOMENTE com JSON neste formato:

```json
{
  "kind": "plate",
  "view": "angle",
  "box": { "x0": 0.08, "y0": 0.2, "x1": 0.92, "y1": 0.86 },
  "food": { "x0": 0.25, "y0": 0.25, "x1": 0.75, "y1": 0.7 },
  "diameterCm": 26,
  "heightCm": 3,
  "foodHeightCm": 4,
  "profile": null
}
```

## Campos

- `kind`: o recipiente (ou a forma, se não houver recipiente):
  - `plate` prato raso; `bowl` tigela, cumbuca, açaí no copo largo, sopa; `glass` copo, taça, suco,
    drinque; `cup` xícara, caneca, café; `stack` lanche alto, hambúrguer, bolo inteiro, torre;
    `slice` fatia (pizza, torta, bolo); `box` embalagem, marmita, caixa; `other` o resto.
- `view`: de onde a foto foi tirada: `top` (de cima, olhando para baixo), `angle` (de lado, por
  volta de 30° a 60°, o mais comum) ou `side` (bem de lado, na altura da mesa).
- `box`: o retângulo do recipiente inteiro na foto (de 0 a 1; x da esquerda, y de cima), incluindo
  a borda do prato. Sem recipiente, o retângulo da comida. Seja preciso: é a parte mais importante.
- `food`: o retângulo só da comida em cima do prato (para pôr volume onde a comida está). `null`
  quando a comida ocupa o prato todo ou não há prato.
- `diameterCm`: diâmetro real estimado do recipiente em cm (prato raso 24–30, sobremesa 18–20,
  tigela 12–18, copo 7–9, xícara 8, hambúrguer 10–12, pizza 30–35).
- `heightCm`: altura real do recipiente (prato 2–3, tigela 6–9, copo 10–15, lanche 7–10).
- `foodHeightCm`: quanto a comida sobe acima do fundo do prato (0 a 15). Purê raso 1–2, arroz e
  feijão 2–3, macarrão 3–5, lanche montado no prato 6–9.
- `profile`: só para `glass`, `cup`, `stack` e `other` vistos de lado: o contorno de baixo para
  cima como lista de pares `[altura, raio]`, os dois de 0 a 1 (altura 0 = base, 1 = topo; raio 1 =
  a parte mais larga). Ex.: copo que abre para cima `[[0,0.7],[0.5,0.85],[1,1]]`; hambúrguer
  `[[0,0.85],[0.1,1],[0.6,0.98],[0.85,0.85],[1,0.3]]`. `null` para usar o padrão do tipo.

## Regras

- Leia só a forma. Não descreva a comida e não invente nada fora da foto.
- Se tiver mais de um item na foto, use o principal (o maior ou o do centro).
- Se a foto não for de comida ou bebida, devolva `{"kind":"none"}`.
- Responda só o JSON, sem texto antes ou depois.
