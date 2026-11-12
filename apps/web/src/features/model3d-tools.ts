/**
 * Onde criar o 3D de um prato fora do Comandou: aplicativos de celular que escaneiam o prato
 * pronto e sites de IA que criam o modelo por foto. Aparece no cadastro do item (Item em 3D).
 * Todos exportam GLB, que é o que o Comandou recebe.
 */
export interface Model3dTool {
  name: string;
  url: string;
  what: string;
}

export const MODEL3D_TOOLS: { title: string; hint: string; tools: Model3dTool[] }[] = [
  {
    title: 'Escanear o prato com o celular',
    hint: 'O resultado mais fiel: é o seu prato de verdade. Dê uma volta completa com o celular, com boa luz.',
    tools: [
      {
        name: 'Polycam',
        url: 'https://poly.cam',
        what: 'iPhone e Android. Fotos ou LiDAR, exporta GLB.',
      },
      {
        name: 'Scaniverse',
        url: 'https://scaniverse.com',
        what: 'iPhone e Android, gratuito. Exporta GLB.',
      },
      {
        name: 'KIRI Engine',
        url: 'https://www.kiriengine.app',
        what: 'Android e iPhone. Bom com objetos pequenos, exporta GLB.',
      },
      {
        name: 'RealityScan',
        url: 'https://www.realityscan.com',
        what: 'Android e iPhone, gratuito (Epic Games).',
      },
      {
        name: 'Luma AI',
        url: 'https://lumalabs.ai',
        what: 'Filme em volta do prato e ele monta o 3D.',
      },
    ],
  },
  {
    title: 'Criar com IA a partir de uma foto',
    hint: 'Rápido, mas a IA inventa a parte que não aparece na foto. Confira antes de publicar.',
    tools: [
      {
        name: 'Meshy',
        url: 'https://www.meshy.ai',
        what: 'Uma foto ou até 4 fotos viram modelo com textura.',
      },
      {
        name: 'Tripo',
        url: 'https://www.tripo3d.ai',
        what: 'Uma foto vira modelo em cerca de um minuto.',
      },
      {
        name: 'Hyper3D Rodin',
        url: 'https://hyper3d.ai',
        what: 'Modelos detalhados a partir de foto.',
      },
      {
        name: 'Hunyuan3D',
        url: 'https://3d.hunyuan.tencent.com',
        what: 'Da Tencent, gratuito e de código aberto.',
      },
      {
        name: 'TripoSR',
        url: 'https://github.com/VAST-AI-Research/TripoSR',
        what: 'Código aberto, para quem quer rodar a IA no próprio computador.',
      },
    ],
  },
  {
    title: 'Conferir e ajustar o arquivo',
    hint: 'Para cortar a mesa que entrou junto ou girar o prato antes de enviar.',
    tools: [
      {
        name: 'gltf.report',
        url: 'https://gltf.report',
        what: 'Abre o GLB no navegador e mostra o tamanho de cada parte.',
      },
      {
        name: 'Blender',
        url: 'https://www.blender.org',
        what: 'Editor 3D gratuito para recortar e limpar o modelo.',
      },
    ],
  },
];
