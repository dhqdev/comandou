// Janela escondida do Bluetooth BLE (Web Bluetooth do Chromium). O processo principal chama
// estas funções por executeJavaScript; a escolha do aparelho acontece no main.mjs, no evento
// "select-bluetooth-device", sem mostrar a lista do Chromium.
'use strict';

// Serviços de escrita que as térmicas BLE costumam ter (ESC/POS por BLE). O Chromium só deixa
// abrir os serviços pedidos aqui.
const SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000ffb0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '000018f1-0000-1000-8000-00805f9b34fb',
];
// Característica preferida de cada serviço (quando há mais de uma de escrita).
const PREFERRED = {
  '000018f0-0000-1000-8000-00805f9b34fb': '00002af1-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb': '0000ff02-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb': '0000ffe1-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb': '0000fff2-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb': '0000ae01-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455': '49535343-8841-43f4-a8d4-ecbe34729bb3',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2': 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
};
const CHUNK = 20; // cabe em qualquer MTU de BLE
const IDLE_MS = 60_000;

/** @type {Map<string, { device: BluetoothDevice, ch?: BluetoothRemoteGATTCharacteristic, idle?: number }>} */
const devices = new Map();
let lastPicked = null;

/** Abre a procura; o main escolhe o aparelho (pela tela ou pelo endereço salvo). */
window.bleRequest = async () => {
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: SERVICES,
  });
  lastPicked = device;
  return { name: device.name || '' };
};

/** Guarda o aparelho escolhido pelo endereço que o main conhece. */
window.bleKeep = (key) => {
  if (!lastPicked) return false;
  const cur = devices.get(key);
  if (cur?.device !== lastPicked) devices.set(key, { device: lastPicked });
  lastPicked = null;
  return true;
};

window.bleKnown = (key) => devices.has(key);

async function characteristic(entry) {
  if (entry.ch && entry.device.gatt.connected) return entry.ch;
  const server = await entry.device.gatt.connect();
  const services = await server.getPrimaryServices();
  let fallback = null;
  for (const s of services) {
    const chars = await s.getCharacteristics().catch(() => []);
    const writable = chars.filter((c) => c.properties.write || c.properties.writeWithoutResponse);
    const best = writable.find((c) => c.uuid === PREFERRED[s.uuid]);
    if (best) return (entry.ch = best);
    fallback ??= writable[0] ?? null;
  }
  if (!fallback) {
    entry.device.gatt.disconnect();
    throw new Error('NO_CHAR');
  }
  return (entry.ch = fallback);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Manda os bytes (em base64) em pedaços pequenos. */
window.bleWrite = async (key, b64) => {
  const entry = devices.get(key);
  if (!entry) throw new Error('NOT_KNOWN');
  clearTimeout(entry.idle);
  const bin = atob(b64);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  try {
    const ch = await characteristic(entry);
    const fast = ch.properties.writeWithoutResponse;
    for (let i = 0; i < data.length; i += CHUNK) {
      const part = data.subarray(i, i + CHUNK);
      if (fast) {
        await ch.writeValueWithoutResponse(part);
        await sleep(6); // dá tempo para o buffer da impressora
      } else await ch.writeValueWithResponse(part);
    }
  } catch (e) {
    entry.ch = undefined;
    try {
      entry.device.gatt.disconnect();
    } catch {
      /* já desligada */
    }
    throw e;
  } finally {
    // Fica ligada um minuto (a próxima comanda sai mais rápido) e depois solta a impressora.
    entry.idle = setTimeout(() => {
      entry.ch = undefined;
      if (entry.device.gatt.connected) entry.device.gatt.disconnect();
    }, IDLE_MS);
  }
  return data.length;
};

// ------------------------------------------------------------------ ícones
// A mesma janela escondida desenha os ícones (o Chromium lê WebP, SVG e JPEG; o Electron só PNG):
// o ícone do restaurante em PNG quadrado e a versão da bandeja com a bolinha da situação.
const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('IMG'));
    img.src = src;
  });

/**
 * Desenha `src` (data: URL) num quadrado de `size` px, com cantos arredondados, e uma bolinha
 * de situação no canto (dot: '#rrggbb' ou null). Devolve PNG em data: URL.
 */
window.renderIcon = async (src, size, dot, round = true) => {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  if (round) {
    const r = size * 0.22;
    g.beginPath();
    g.roundRect(0, 0, size, size, r);
    g.clip();
  }
  // Cobre o quadrado sem deformar (logo retangular fica centralizado).
  const k = Math.max(size / img.width, size / img.height);
  const w = img.width * k;
  const h = img.height * k;
  g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  if (dot) {
    g.restore?.();
    const c2 = document.createElement('canvas');
    c2.width = c2.height = size;
    const g2 = c2.getContext('2d');
    g2.drawImage(c, 0, 0);
    const d = size * 0.42;
    const x = size - d / 2 - size * 0.02;
    const y = size - d / 2 - size * 0.02;
    g2.beginPath();
    g2.arc(x, y, d / 2, 0, Math.PI * 2);
    g2.fillStyle = '#ffffff';
    g2.fill();
    g2.beginPath();
    g2.arc(x, y, d / 2 - Math.max(1, size * 0.06), 0, Math.PI * 2);
    g2.fillStyle = dot;
    g2.fill();
    return c2.toDataURL('image/png');
  }
  return c.toDataURL('image/png');
};

// ------------------------------------------------------------------ logo da bobina
/**
 * Logo do restaurante em pontos pretos e brancos para a térmica (GS v 0): cabe em `maxW` x `maxH`
 * pontos, fundo transparente vira branco, tons de cinza viram pontilhado (Floyd–Steinberg) para
 * a logo colorida não sair um borrão preto. Devolve { width, height, data } com data em base64
 * (width / 8 bytes por linha, bit 1 = ponto preto).
 */
window.renderLogo = async (src, maxW, maxH) => {
  const img = await loadImage(src);
  const k = Math.min(1, maxW / img.width, maxH / img.height);
  const width = Math.max(8, Math.round((img.width * k) / 8) * 8);
  const height = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, width, height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, width, height);
  const px = g.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++)
    gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  const bytesPerRow = width / 8;
  const out = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = gray[i];
      const black = old < 128;
      if (black) out[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      const err = old - (black ? 0 : 255);
      if (x + 1 < width) gray[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) gray[i + width - 1] += (err * 3) / 16;
        gray[i + width] += (err * 5) / 16;
        if (x + 1 < width) gray[i + width + 1] += err / 16;
      }
    }
  let bin = '';
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
  return { width, height, data: btoa(bin) };
};
