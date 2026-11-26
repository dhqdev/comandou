import { describe, expect, it } from 'vitest';
import { sizedMedia } from './media-size';

describe('sizedMedia', () => {
  const id = '0b7c2f8e-1d2a-4f3b-9c4d-5e6f7a8b9c0d';
  it('pede a miniatura das fotos do Comandou', () => {
    expect(sizedMedia(`/api/v1/media/${id}`, 320)).toBe(`/api/v1/media/${id}?w=320`);
  });
  it('deixa o resto como está', () => {
    expect(sizedMedia(null, 640)).toBeNull();
    expect(sizedMedia(undefined, 640)).toBeUndefined();
    expect(sizedMedia('blob:http://x/1', 640)).toBe('blob:http://x/1');
    expect(sizedMedia(`/api/v1/media/${id}?w=320`, 640)).toBe(`/api/v1/media/${id}?w=320`);
    expect(sizedMedia('https://outro.site/foto.jpg', 320)).toBe('https://outro.site/foto.jpg');
  });
});
