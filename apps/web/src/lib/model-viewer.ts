/**
 * Carrega o @google/model-viewer só quando uma tela mostra um modelo 3D (ele é grande). O
 * descompactador de malhas (Draco) vem do próprio Comandou: a política de conteúdo bloqueia o
 * gstatic.com, então a configuração global vai antes do import.
 */
let lib: Promise<unknown> | null = null;

export function loadModelViewer(): Promise<unknown> {
  const g = self as unknown as { ModelViewerElement?: Record<string, unknown> };
  g.ModelViewerElement = { ...g.ModelViewerElement, dracoDecoderLocation: '/vendor/draco/' };
  lib ??= import('@google/model-viewer');
  lib.catch(() => (lib = null));
  return lib;
}
