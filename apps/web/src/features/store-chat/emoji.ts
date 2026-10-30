/** Emojis do seletor da conversa com a loja, por grupo (os mais usados ficam guardados). */
export interface EmojiGroup {
  id: string;
  label: string;
  icon: string;
  list: string[];
}

const split = (s: string) => s.trim().split(/\s+/);

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    id: 'rostos',
    label: 'Carinhas',
    icon: '😀',
    list: split(`😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 🥲 😋 😛 😜 🤪 😝
      🤑 🤗 🤭 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮
      🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭
      😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 🤖 😺 😸 😹 😻 😼 🙈 🙉 🙊`),
  },
  {
    id: 'gestos',
    label: 'Gestos',
    icon: '👍',
    list: split(`👍 👎 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👋 🤚 🖐️ ✋ 🖖 👏 🙌 🫶 👐
      🤲 🤝 🙏 ✍️ 💪 🦾 👀 👁️ 👅 👄 🫦 🧠 🫀 🙋 🙋‍♂️ 🙆 🙅 🤷 🤦 💁 🙇 🧑‍🍳 👨‍🍳 👩‍🍳 🛵 🏃 🚶 🧍`),
  },
  {
    id: 'coracoes',
    label: 'Amor',
    icon: '❤️',
    list: split(`❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 🩷 🩵 💔 ❤️‍🔥 ❤️‍🩹 💕 💞 💓 💗 💖 💘 💝 💟 ♥️
      💋 😻 💐 🌹 🌷 🌻 🌸 ✨ ⭐ 🌟 💫 🔥 💯 🎉 🎊 🥳 🎁 🎈 🏆 🥇`),
  },
  {
    id: 'comida',
    label: 'Comida',
    icon: '🍔',
    list: split(`🍔 🍟 🍕 🌭 🥪 🌮 🌯 🫔 🥙 🧆 🥚 🍳 🥘 🍲 🫕 🥣 🥗 🍿 🧈 🧂 🥫 🍝 🍜 🍛 🍣 🍱 🥟
      🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍩 🍪 🌰 🥜 🍯 🥐 🍞 🥖 🫓 🥨
      🥯 🥞 🧇 🧀 🍖 🍗 🥩 🥓 🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒
      🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠`),
  },
  {
    id: 'bebidas',
    label: 'Bebidas',
    icon: '🥤',
    list: split(`☕ 🫖 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾 🧊 🥛 🍼 💧 🥄 🍴 🍽️ 🥢 🔪`),
  },
  {
    id: 'coisas',
    label: 'Objetos',
    icon: '📦',
    list: split(`📦 🛍️ 🧾 💰 💵 💳 🪙 🏷️ 📍 🗺️ 🏠 🏢 🏪 🚪 🛎️ 🔔 📱 📞 ☎️ 💬 💭 🗨️ 📸 🎥 ⏰ ⏳ ⌛
      🕐 📅 🗓️ ✏️ 📝 📌 📎 🔑 🎂 🎁 🎀 🧸 🎮 ⚽ 🏀 🎵 🎶 🎤 🎧 📺 💡 🔋 🧯 🚗 🚕 🛵 🏍️ 🚲 🛻 🚚 ✈️ 🌧️ ☀️ 🌙 ⛅ ❄️ 🌈`),
  },
  {
    id: 'simbolos',
    label: 'Símbolos',
    icon: '✅',
    list: split(`✅ ☑️ ✔️ ❌ ❎ ⚠️ 🚫 ⛔ ❗ ❕ ❓ ❔ ‼️ ⁉️ 💲 ➕ ➖ ✖️ ➗ 🆗 🆕 🆓 🔝 🔜 🔙 ⬆️ ⬇️ ➡️ ⬅️
      🔄 🔁 ▶️ ⏸️ ⏹️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔶 🔷 🔸 🔹 ♻️ 🌱 🍀 🇧🇷`),
  },
];

const RECENT_KEY = 'cm.chat.emojis';

export function recentEmojis(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 24) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(e: string) {
  try {
    const list = [e, ...recentEmojis().filter((x) => x !== e)].slice(0, 24);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* sem armazenamento: só não lembra */
  }
}

/** Mensagem só com emojis (até 3) aparece grande, sem balão. */
export function emojiOnly(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 24) return false;
  const seg =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(t.replace(/\s+/g, ''))]
      : null;
  if (!seg || seg.length > 3) return false;
  return seg.every((s) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s.segment));
}
