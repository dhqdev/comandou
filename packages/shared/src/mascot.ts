/**
 * Roupinhas do panda (o mascote). Cada pessoa da equipe veste o seu panda; a escolha fica salva
 * na conta (API /me/mascot) e no aparelho, para abrir já vestido. Cada peça ocupa um lugar:
 * cabeça ou pescoço. Os desenhos ficam na web (design-system/panda-wear.tsx).
 */
export const MASCOT_SLOTS = [
  { id: 'head', label: 'Cabeça' },
  { id: 'neck', label: 'Pescoço' },
] as const;
export type MascotSlot = (typeof MASCOT_SLOTS)[number]['id'];

export const MASCOT_ITEMS = [
  { id: 'chef', slot: 'head', label: 'Touca de chef' },
  { id: 'cap', slot: 'head', label: 'Boné' },
  { id: 'headset', slot: 'head', label: 'Fone' },
  { id: 'santa', slot: 'head', label: 'Gorro de Natal' },
  { id: 'bandana', slot: 'neck', label: 'Lenço' },
  { id: 'bowtie', slot: 'neck', label: 'Gravatinha' },
  { id: 'scarf', slot: 'neck', label: 'Cachecol' },
] as const;
export type MascotItemId = (typeof MASCOT_ITEMS)[number]['id'];

export type MascotOutfit = Partial<Record<MascotSlot, MascotItemId>>;

/** Combinações prontas, uma para cada função do restaurante. */
export const MASCOT_LOOKS: { id: string; label: string; outfit: MascotOutfit }[] = [
  { id: 'chef', label: 'Chef', outfit: { head: 'chef', neck: 'bandana' } },
  { id: 'garcom', label: 'Garçom', outfit: { neck: 'bowtie' } },
  { id: 'entregador', label: 'Entregador', outfit: { head: 'cap' } },
  { id: 'atendente', label: 'Atendente', outfit: { head: 'headset' } },
  { id: 'natal', label: 'Natal', outfit: { head: 'santa', neck: 'scarf' } },
];

export interface MascotPrefs {
  outfit: MascotOutfit;
  /** O panda passeia pelo canto da tela de vez em quando. */
  stroll: boolean;
}

export const DEFAULT_MASCOT: MascotPrefs = { outfit: {}, stroll: true };

/** Limpa o que veio de fora (aparelho ou API): só peças que existem e no lugar certo. */
export function cleanOutfit(raw: unknown): MascotOutfit {
  const out: MascotOutfit = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const slot of MASCOT_SLOTS) {
    const v = (raw as Record<string, unknown>)[slot.id];
    const item = MASCOT_ITEMS.find((i) => i.id === v && i.slot === slot.id);
    if (item) out[slot.id] = item.id;
  }
  return out;
}
