import { Browsers } from 'baileys';

/**
 * Como o Comandou se apresenta ao WhatsApp ao ler o QR Code: o celular mostra em
 * "Aparelhos conectados" um computador "Mac OS", o mesmo que o WhatsApp para Mac e as
 * integrações comuns do Baileys (`Browsers.macOS('Desktop')`).
 *
 * O WhatsApp só lê isto no pareamento: o primeiro campo vira o nome do aparelho e o segundo, o
 * tipo (Desktop = computador). Antes era `Browsers.ubuntu('Comandou')`: o nome ia "Ubuntu" e o
 * tipo, que o Baileys não reconhece ("Comandou"), caía no mesmo computador; só o nome muda. Sessões
 * já pareadas continuam com o nome antigo até desconectar e ler o QR Code de novo (o login de todo
 * dia não manda o nome).
 */
export const DEVICE_BROWSER = Browsers.macOS('Desktop');
