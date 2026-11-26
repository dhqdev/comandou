/**
 * Partes do restaurante que gastam IA, para o gráfico de pizza do Super Admin › Tokens de IA.
 * Cada `source` gravado em `ai_usage` cai numa parte; fonte nova sem parte vira "Outros" (e o
 * teste acusa). A ordem é fixa: a cor de cada parte no gráfico segue esta ordem, não o tamanho.
 */
export interface AiPartDef {
  key: string;
  label: string;
  sources: readonly string[];
}

export const AI_PARTS: readonly AiPartDef[] = [
  { key: 'whatsapp', label: 'IA do WhatsApp', sources: ['whatsapp', 'agent_test'] },
  { key: 'chat', label: 'Chat com a IA', sources: ['chat'] },
  { key: 'print', label: 'Modelo de impressão', sources: ['print_template'] },
  {
    key: 'photos',
    label: 'Fotos dos itens',
    sources: ['photo_tune', 'photo_clean', 'photo_create', 'menu_photo'],
  },
  { key: 'model3d', label: '3D dos itens', sources: ['menu_model'] },
  {
    key: 'setup',
    label: 'Cardápio e página',
    sources: ['menu_import', 'menu_place', 'site_page'],
  },
];

export const OTHER_PART: AiPartDef = { key: 'other', label: 'Outros', sources: [] };

/** Nome de cada fonte, no detalhe da parte. */
export const TENANT_SOURCE_LABEL: Record<string, string> = {
  whatsapp: 'Respostas no WhatsApp',
  agent_test: 'Teste do assistente do WhatsApp',
  chat: 'Chat da equipe com a IA',
  print_template: 'IA do modelo de impressão',
  photo_tune: 'Melhorar a foto do item',
  photo_clean: 'Foto com fundo limpo',
  photo_create: 'Foto criada pela IA',
  menu_photo: 'Foto do item na importação',
  menu_model: 'Item em 3D pela foto',
  menu_import: 'Importar o cardápio',
  menu_place: 'Achar o restaurante no Google',
  site_page: 'Texto da página do restaurante',
};

const BY_SOURCE = new Map<string, AiPartDef>();
for (const p of AI_PARTS) for (const s of p.sources) BY_SOURCE.set(s, p);

export const partOf = (source: string): AiPartDef => BY_SOURCE.get(source) ?? OTHER_PART;

export interface SourceUse {
  source: string;
  tokens: number;
  costUsd: number;
  calls: number;
}

export interface PartUse {
  key: string;
  label: string;
  tokens: number;
  costUsd: number;
  calls: number;
  /** Parte do total do período, em tokens (0–100, uma casa). */
  percent: number;
  sources: (SourceUse & { label: string })[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Junta o uso por fonte nas partes, na ordem fixa de `AI_PARTS` (o "Outros" no fim). Só volta
 * parte que gastou algo; dentro dela, as fontes da que mais gastou para a que menos gastou.
 */
export function groupParts(rows: SourceUse[]): PartUse[] {
  const total = rows.reduce((n, r) => n + r.tokens, 0);
  const acc = new Map<string, PartUse>();
  for (const r of rows) {
    if (r.tokens <= 0 && r.costUsd <= 0 && r.calls <= 0) continue;
    const def = partOf(r.source);
    const cur =
      acc.get(def.key) ??
      ({
        key: def.key,
        label: def.label,
        tokens: 0,
        costUsd: 0,
        calls: 0,
        percent: 0,
        sources: [],
      } as PartUse);
    cur.tokens += r.tokens;
    cur.costUsd += r.costUsd;
    cur.calls += r.calls;
    cur.sources.push({ ...r, label: TENANT_SOURCE_LABEL[r.source] ?? r.source });
    acc.set(def.key, cur);
  }
  const order = [...AI_PARTS.map((p) => p.key), OTHER_PART.key];
  return order
    .map((k) => acc.get(k))
    .filter((p): p is PartUse => !!p)
    .map((p) => ({
      ...p,
      costUsd: Math.round(p.costUsd * 1e6) / 1e6,
      percent: total > 0 ? round1((p.tokens / total) * 100) : 0,
      sources: p.sources.sort((a, b) => b.tokens - a.tokens),
    }));
}
