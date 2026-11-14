import { describe, expect, it } from 'vitest';
import { isPrivateIp, normalizeUrl } from '../common/safe-fetch';
import { readImport } from './menu-import.service';
import { extractPage, hexColor, pageForModel, readBox, readStore } from './store-import';

describe('primeiros passos: link seguro', () => {
  it('bloqueia rede interna e aceita IP público', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.0.10',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ])
      expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '200.147.67.142', '2606:4700::6810:85e5'])
      expect(isPrivateIp(ip), ip).toBe(false);
  });

  it('completa o https e recusa o que não é site público', () => {
    expect(normalizeUrl('bellaserra.com.br/cardapio')?.toString()).toBe(
      'https://bellaserra.com.br/cardapio',
    );
    expect(normalizeUrl('http://loja.com:8080/x')).toBeNull();
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeUrl('http://localhost/')).toBeNull();
    expect(normalizeUrl('https://user:pw@site.com')).toBeNull();
    expect(normalizeUrl('http://intranet.local')).toBeNull();
  });
});

describe('primeiros passos: leitura da página', () => {
  const html = `<!doctype html><html><head>
    <title>Bella Serra &amp; Cia | Cardápio</title>
    <meta name="theme-color" content="#B71C1C">
    <meta property="og:image" content="/capa.jpg">
    <link rel="icon" href="/favicon.ico">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
    <style>:root{--primary-color:#b71c1c} .btn{background:#ffc107;color:#fff} .x{color:#333}</style>
    <script type="application/ld+json">{"@type":"Restaurant","telephone":"(11) 98888-7777"}</script>
    </head><body>
    <img src="/logo.png" alt="Bella Serra logo">
    <h2>Pizzas</h2>
    <div><img data-src="https://cdn.site.com/p1.jpg" alt="Calabresa"><b>Calabresa</b> R$ 49,90</div>
    <div style="background-image:url('/p2.webp')"><b>Margherita</b> R$ 45,00</div>
    <script>var x = "não é texto";</script>
    </body></html>`;
  const p = extractPage(html, 'https://bellaserra.com.br/cardapio');

  it('separa título, cor do tema, ícones, imagens e cores do CSS', () => {
    expect(p.title).toBe('Bella Serra & Cia | Cardápio');
    expect(p.themeColor).toBe('#b71c1c');
    expect(p.icons[0]).toBe('https://bellaserra.com.br/apple.png');
    expect(p.ogImage).toBe('https://bellaserra.com.br/capa.jpg');
    expect(p.images).toEqual([
      'https://bellaserra.com.br/logo.png',
      'https://cdn.site.com/p1.jpg',
      'https://bellaserra.com.br/p2.webp',
      'https://bellaserra.com.br/capa.jpg',
    ]);
    expect(p.colors[0]).toBe('#b71c1c');
    expect(p.colors).toContain('#ffc107');
    expect(p.colors).not.toContain('#333333');
    expect(p.jsonLd).toContain('98888-7777');
  });

  it('marca a posição das imagens no texto e tira os scripts', () => {
    expect(p.text).toContain('[img 1] (Calabresa)');
    expect(p.text).toContain('[img 2]');
    expect(p.text).not.toContain('não é texto');
    expect(pageForModel(p)).toContain('Cor do tema (theme-color): #b71c1c');
  });
});

describe('primeiros passos: dados da loja vindos da IA', () => {
  it('limpa telefone, UF, horário, cores e aponta as imagens', () => {
    const s = readStore(
      {
        name: ' Bella  Serra ',
        whatsapp: '+55 (11) 98888-7777',
        state: 'sp',
        cep: '01310-100',
        hours: [
          { day: 1, open: '18h', close: '23:00' },
          { day: 9, open: '18:00', close: '23:00' },
          { day: 2, open: '18:00', close: '18:00' },
        ],
        brandColor: '#B71',
        accentColor: '#bb7711',
        logo: 0,
        cover: '7',
      },
      ['https://x.com/logo.png'],
    );
    expect(s).toMatchObject({
      name: 'Bella Serra',
      whatsapp: '11988887777',
      state: 'SP',
      cep: '01310100',
      hours: [{ day: 1, open: '18:00', close: '23:00' }],
      brandColor: '#bb7711',
      accentColor: null,
      logoUrl: 'https://x.com/logo.png',
      coverUrl: null,
    });
  });

  it('caixa da foto: só 0–1000 e com tamanho de miniatura', () => {
    expect(readBox([100, 50, 400, 300])).toEqual([100, 50, 400, 300]);
    expect(readBox([100, 50, 110, 300])).toBeNull();
    expect(readBox([0, 0, 1200, 10])).toBeNull();
    expect(hexColor('#ABC')).toBe('#aabbcc');
  });

  it('item recebe a foto da página, sem repetir a mesma em dois itens nem usar o logo', () => {
    const imgs = ['https://x.com/logo.png', 'https://x.com/a.jpg'];
    const r = readImport(
      JSON.stringify({
        store: { logo: 0 },
        categories: [
          {
            name: 'Pizzas',
            items: [
              { name: 'A', price: '10', image: 1 },
              { name: 'B', price: '12', image: 1 },
              { name: 'C', price: '12', image: 0, photo: [10, 10, 500, 500] },
            ],
          },
        ],
      }),
      imgs,
    );
    const [a, b, c] = r.categories[0]!.items;
    expect(a!.imageUrl).toBe('https://x.com/a.jpg');
    expect(b!.imageUrl).toBeUndefined();
    expect(c!.imageUrl).toBeUndefined();
    expect(c!.photoBox).toEqual([10, 10, 500, 500]);
    expect(r.store.logoUrl).toBe('https://x.com/logo.png');
  });
});
