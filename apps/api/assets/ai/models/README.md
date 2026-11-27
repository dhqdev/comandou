# Modelos que rodam no servidor

## u2netp.onnx

Recorte do item na foto para o "Fazer o 3D pela foto" (`src/catalog/cutout*.ts`).

- **Modelo:** U²-Netp (versão pequena do U²-Net), de Xuebin Qin et al.,
  <https://github.com/xuebinqin/U-2-Net>. Licença **Apache 2.0**.
- **Arquivo:** a exportação ONNX do projeto rembg,
  <https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx>.
- **SHA-256:** `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` (4,5 MB).
- **Entrada:** 1 × 3 × 320 × 320, RGB normalizado pela média e desvio do ImageNet.
  **Saída:** o primeiro tensor, 1 × 1 × 320 × 320, quanto cada ponto é o objeto principal.

Trocar o modelo: mesmo formato de entrada e saída, conferir o teste `cutout.test.ts` (ele roda o
modelo numa foto de verdade do site) e atualizar o SHA-256 aqui.
