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
