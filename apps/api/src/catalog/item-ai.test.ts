import { describe, expect, it } from 'vitest';
import { imageSize } from '../common/image-size';
import { aiPrompt, cleanPrompt, photoPrompts } from './ai-prompts';
import { jsonOf, notFood, readCrop, readTips } from './item-ai';

describe('Melhorar a foto do item', () => {
  it('o retoque da IA é sempre leve: números presos nas faixas e textos curtos', () => {
    const t = readTips({
      score: 14,
      summary: '  Clareei   um pouco.  ',
      tips: ['Use a luz da janela', '', 7, 'Fotografe de 45°', 'Limpe a borda', 'Mais uma'],
      adjust: { brightness: 2, contrast: -9, saturation: 0.9, warmth: 'muito' },
      crop: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.95 },
      background: 'qualquer',
      cleanWorth: 'sim',
    });
    expect(t.score).toBe(10);
    expect(t.summary).toBe('Clareei um pouco.');
    expect(t.tips).toEqual(['Use a luz da janela', 'Fotografe de 45°', 'Limpe a borda']);
    expect(t.adjust).toEqual({ brightness: 0.3, contrast: -0.3, saturation: 0.4, warmth: 0 });
    expect(t.crop).toEqual({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.95 });
    expect(t.background).toBe('ok');
    expect(t.cleanWorth).toBe(false);
  });

  it('resposta vazia ou estragada vira um retoque neutro', () => {
    expect(readTips(jsonOf('não sei'))).toMatchObject({
      adjust: { brightness: 0, contrast: 0, saturation: 0, warmth: 0 },
      crop: null,
      tips: [],
    });
    expect(jsonOf('```json\n{"score": 6}\n```')).toEqual({ score: 6 });
    expect(jsonOf('[1,2]')).toBeNull();
  });

  it('corte só quando tira sobra de verdade e não come a comida', () => {
    expect(readCrop({ x0: 0, y0: 0, x1: 1, y1: 1 })).toBeNull();
    expect(readCrop({ x0: 0.3, y0: 0.1, x1: 0.7, y1: 0.9 })).toBeNull();
    expect(readCrop({ x0: 0.9, y0: 0.05, x1: 0.1, y1: 0.95 })).toEqual({
      x0: 0.1,
      y0: 0.05,
      x1: 0.9,
      y1: 0.95,
    });
    expect(readCrop(null)).toBeNull();
  });

  it('o .md tem a leitura da foto e o pedido do fundo limpo, com o nome do item', () => {
    const { analysis, clean } = photoPrompts(aiPrompt('melhorar-foto'));
    expect(analysis).toContain('"adjust"');
    expect(analysis).not.toContain('{{item}}');
    expect(clean).toContain('{{item}}');
    expect(clean).not.toContain('##');
    const p = cleanPrompt(clean, 'Bife "acebolado"\ncom fritas');
    expect(p).toContain('Bife acebolado com fritas');
    expect(p).not.toContain('{{item}}');
  });

  it('o .md do 3D pede a forma com os tipos que o servidor monta', () => {
    const md = aiPrompt('item-3d');
    for (const k of ['plate', 'bowl', 'glass', 'cup', 'stack', 'diameterCm', '"none"'])
      expect(md).toContain(k);
    expect(notFood({ kind: 'none' })).toBe(true);
    expect(notFood(null)).toBe(true);
    expect(notFood({ kind: 'plate' })).toBe(false);
  });
});

describe('Tamanho da foto lido do arquivo', () => {
  it('PNG pelo cabeçalho IHDR', () => {
    const png = Buffer.alloc(33);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(0x0d0a1a0a, 4);
    png.writeUInt32BE(13, 8);
    png.write('IHDR', 12, 'latin1');
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(imageSize(png)).toEqual({ width: 640, height: 480 });
  });

  it('JPEG pelo quadro (SOF), pulando os blocos antes dele', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
    const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x00, 0x04, 0x00, 0x03, 0x01, 0x22, 0x00];
    const jpg = Buffer.from([0xff, 0xd8, ...app0, ...sof, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]);
    expect(imageSize(jpg)).toEqual({ width: 1024, height: 768 });
    expect(imageSize(Buffer.from('não é foto'))).toBeNull();
  });
});
