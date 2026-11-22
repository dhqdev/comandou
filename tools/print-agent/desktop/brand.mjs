// Marca do restaurante no aplicativo: o ícone (janela, barra de tarefas, bandeja e atalhos do
// Windows) e as cores/tema da tela vêm do Comandou pelo heartbeat. Sem ícone escolhido, fica o
// do Comandou. A bolinha da bandeja mostra a situação: verde conectado, amarelo tentando,
// vermelho desconectado.
import { app, nativeImage, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setPrintLogo } from '../printers.mjs';
import { DOT, pngToIco } from './pure.mjs';

const fromDataUrl = (u) => Buffer.from(String(u).split(',')[1] ?? '', 'base64');

export class Brand {
  /**
   * @param {{ helper: { call: (code: string) => Promise<any> }, defaultIcon: string,
   *   onChange: () => void }} o
   */
  constructor(o) {
    this.o = o;
    this.dir = join(app.getPath('userData'), 'marca');
    /** ícone base (data: URL PNG 256) do restaurante, ou null = o do Comandou */
    this.icon = null;
    this.iconKey = null;
    this.tray = new Map();
    /** endereço da logo da bobina já preparada (undefined = ainda não olhou o disco) */
    this.logoKey = undefined;
  }

  /** Lê o ícone salvo (abre já com a cara do restaurante, antes do primeiro heartbeat). */
  async load(key) {
    const file = join(this.dir, 'icone.png');
    if (!key || !existsSync(file)) return;
    this.icon = `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
    this.iconKey = key;
  }

  /** Baixa e prepara o ícone novo quando o restaurante troca o dele. */
  async update(baseUrl, iconUrl) {
    if (!iconUrl) {
      if (this.icon) {
        this.icon = null;
        this.iconKey = null;
        this.tray.clear();
        this.o.onChange();
      }
      return;
    }
    if (iconUrl === this.iconKey) return;
    const res = await fetch(new URL(iconUrl, baseUrl), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return;
    const type = res.headers.get('content-type') || 'image/png';
    if (!/^image\//.test(type)) return;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 5_000_000) return;
    const src = `data:${type};base64,${bytes.toString('base64')}`;
    const png = await this.o.helper.call(`renderIcon(${JSON.stringify(src)}, 256, null)`);
    await mkdir(this.dir, { recursive: true });
    const buf = fromDataUrl(png);
    await writeFile(join(this.dir, 'icone.png'), buf);
    await writeFile(join(this.dir, 'icone.ico'), pngToIco(buf));
    this.icon = png;
    this.iconKey = iconUrl;
    this.tray.clear();
    this.updateShortcuts();
    this.o.onChange();
  }

  /**
   * Logo da bobina (a da Loja online): baixada quando muda, convertida em pontos pretos e brancos
   * pela janela escondida e guardada no disco, para imprimir já na primeira comanda do dia.
   */
  async updateLogo(baseUrl, logoUrl) {
    const file = join(this.dir, 'logo-bobina.json');
    if (!logoUrl) {
      if (this.logoKey !== null) {
        this.logoKey = null;
        setPrintLogo(null);
        await writeFile(file, '{}').catch(() => undefined);
      }
      return;
    }
    if (logoUrl === this.logoKey) return;
    if (this.logoKey === undefined && existsSync(file)) {
      // Abriu agora: usa a que já estava salva, se for a mesma logo.
      try {
        const saved = JSON.parse(await readFile(file, 'utf8'));
        if (saved.key === logoUrl && saved.data) {
          setPrintLogo({ ...saved, data: Buffer.from(saved.data, 'base64') });
          this.logoKey = logoUrl;
          return;
        }
      } catch {
        /* arquivo estragado: baixa de novo */
      }
    }
    const res = await fetch(new URL(logoUrl, baseUrl), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return;
    const type = res.headers.get('content-type') || 'image/png';
    if (!/^image\//.test(type)) return;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 5_000_000) return;
    const src = `data:${type};base64,${bytes.toString('base64')}`;
    const img = await this.o.helper.call(`renderLogo(${JSON.stringify(src)}, 320, 160)`);
    if (!img?.width || !img?.height || typeof img.data !== 'string') return;
    setPrintLogo({ width: img.width, height: img.height, data: Buffer.from(img.data, 'base64') });
    this.logoKey = logoUrl;
    await mkdir(this.dir, { recursive: true });
    await writeFile(file, JSON.stringify({ key: logoUrl, ...img }));
  }

  /** Imagem da janela e da barra de tarefas. */
  windowImage() {
    return this.icon
      ? nativeImage.createFromDataURL(this.icon)
      : nativeImage.createFromPath(this.o.defaultIcon);
  }

  /** Ícone da bandeja com a bolinha da situação (cache por situação). */
  async trayImage(state) {
    const dot = DOT[state] ?? DOT.idle;
    const key = `${this.iconKey ?? 'padrao'}:${dot}`;
    if (!this.tray.has(key)) {
      const base =
        this.icon ??
        `data:image/png;base64,${(await readFile(this.o.defaultIcon)).toString('base64')}`;
      const size = process.platform === 'darwin' ? 22 : 32;
      const [x1, x2] = await Promise.all([
        this.o.helper.call(`renderIcon(${JSON.stringify(base)}, ${size}, ${JSON.stringify(dot)})`),
        this.o.helper.call(
          `renderIcon(${JSON.stringify(base)}, ${size * 2}, ${JSON.stringify(dot)})`,
        ),
      ]);
      const img = nativeImage.createEmpty();
      img.addRepresentation({ scaleFactor: 1, dataURL: x1 });
      img.addRepresentation({ scaleFactor: 2, dataURL: x2 });
      this.tray.set(key, img);
    }
    return this.tray.get(key);
  }

  /** Só a bolinha (sobreposta ao ícone na barra de tarefas do Windows). */
  async dotImage(state) {
    const dot = DOT[state] ?? DOT.idle;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#fff"/><circle cx="16" cy="16" r="11" fill="${dot}"/></svg>`;
    const png = await this.o.helper.call(
      `renderIcon(${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)}, 32, null, false)`,
    );
    return nativeImage.createFromDataURL(png);
  }

  /** Windows: atalhos da área de trabalho e do Iniciar com o ícone do restaurante. */
  updateShortcuts() {
    if (process.platform !== 'win32' || !app.isPackaged) return;
    const ico = join(this.dir, 'icone.ico');
    const places = [
      join(app.getPath('desktop'), 'Comandou Impressão.lnk'),
      join(
        app.getPath('appData'),
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
        'Comandou Impressão.lnk',
      ),
    ];
    for (const lnk of places) {
      if (!existsSync(lnk)) continue;
      try {
        shell.writeShortcutLink(lnk, 'update', {
          icon: this.icon ? ico : process.execPath,
          iconIndex: 0,
          appUserModelId: 'br.com.comandou.impressao',
        });
      } catch {
        /* atalho sem permissão: fica o ícone de antes */
      }
    }
  }
}
