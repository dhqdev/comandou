import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Ctx } from '../common/context';
import { sniff } from '../common/file-sniff';
import { open } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { AI_KEY_CONTEXT } from './ai.service';
import { availableTokens, loadAiQuota, recordAiUsage } from './ai-quota';
import { ContentPart, OpenRouterClient, OpenRouterError } from './openrouter';

export interface ImportedItem {
  name: string;
  description: string | null;
  /** Preço em reais com duas casas ("24.90"); null quando o cardápio não mostra. */
  price: string | null;
}
export interface ImportedCategory {
  name: string;
  items: ImportedItem[];
}

export const IMPORT_MAX_BYTES = 3 * 1024 * 1024;
const MAX_ITEMS = 300;

const PROMPT = `Você lê cardápios de restaurantes brasileiros (foto do cardápio, foto de um prato ou PDF) e devolve os itens organizados.

Responda SOMENTE com JSON neste formato:
{"categories":[{"name":"Nome da categoria","items":[{"name":"Nome do item","description":"descrição curta ou null","price":"24.90 ou null"}]}]}

Regras:
- Copie nomes, descrições e preços como estão escritos. Não invente item, descrição nem preço.
- "price" é o preço em reais com ponto e duas casas, sem "R$" (ex.: "24.90"). Sem preço visível: null.
- Item com tamanhos ou variações de preço (P, M, G; 300 ml, 500 ml): crie um item para cada, com o tamanho no nome ("Pizza Calabresa G").
- Use as categorias do próprio cardápio (Lanches, Pizzas, Bebidas...). Se não houver, agrupe pelo tipo do item.
- Nomes com a primeira letra maiúscula, sem tudo em maiúsculas.
- Foto de um único prato, sem texto: devolva um item com o nome mais provável do prato, uma descrição curta do que aparece e "price": null, na categoria que fizer sentido.
- Se não houver comida, bebida nem cardápio na imagem, devolva {"categories":[]}.`;

const clip = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** "R$ 24,90", "24.9", 24.9 → "24.90"; o que não for preço vira null. */
export function parsePrice(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  let s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return null;
  // Vírgula decimal brasileira: "1.234,50" → "1234.50".
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 99_999) return null;
  return n.toFixed(2);
}

/** Limpa o que o modelo devolveu: só o formato esperado, com limites de tamanho. */
export function normalizeImport(raw: string): ImportedCategory[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let j: unknown;
  try {
    j = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const cats = (j as { categories?: unknown }).categories;
  if (!Array.isArray(cats)) return [];
  const out: ImportedCategory[] = [];
  let total = 0;
  for (const c of cats) {
    const name = clip((c as { name?: unknown })?.name, 60) || 'Cardápio';
    const items: ImportedItem[] = [];
    const list = (c as { items?: unknown })?.items;
    for (const it of Array.isArray(list) ? list : []) {
      if (total >= MAX_ITEMS) break;
      const n = clip((it as { name?: unknown })?.name, 120);
      if (!n) continue;
      items.push({
        name: n,
        description: clip((it as { description?: unknown })?.description, 500) || null,
        price: parsePrice((it as { price?: unknown })?.price),
      });
      total++;
    }
    if (!items.length) continue;
    const same = out.find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (same) same.items.push(...items);
    else out.push({ name, items });
  }
  return out;
}

/**
 * Importar o cardápio com IA: a pessoa manda a foto do cardápio, a foto de um prato ou um PDF e
 * o modelo devolve categorias, itens, descrições e preços para ela conferir antes de salvar.
 * Usa a chave do OpenRouter do painel Super Admin e desconta do limite de tokens do restaurante
 * (fonte "menu_import" no extrato de uso).
 */
@Injectable()
export class MenuImportService {
  private readonly logger = new Logger('MenuImportService');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
  ) {}

  /** A tela pergunta antes de oferecer a importação: está ligada e ainda há tokens? */
  async status(ctx: Ctx) {
    const qt = await this.db.withCentral(ctx, (tx) => loadAiQuota(tx));
    const c = qt.config;
    const reason =
      !c.enabled || !c.api_key_enc || !this.env.INTEGRATIONS_KEY
        ? 'platform'
        : !c.tenant_enabled
          ? 'tenant'
          : qt.blocked
            ? 'limit'
            : null;
    return {
      enabled: reason === null,
      reason,
      assistantName: c.assistant_name,
      usage: {
        used: qt.used,
        limit: c.monthly_tokens,
        bonus: c.bonus_tokens,
        available: availableTokens(c.monthly_tokens, qt.used, c.bonus_tokens),
      },
    };
  }

  async analyze(ctx: Ctx, file: Buffer, mime: string) {
    if (file.length === 0 || file.length > IMPORT_MAX_BYTES)
      throw new UnprocessableEntityException('Arquivo vazio ou maior que 3 MB');
    const isPdf = mime === 'application/pdf';
    if (isPdf ? file.toString('latin1', 0, 5) !== '%PDF-' : sniff(file) !== mime)
      throw new UnprocessableEntityException('Envie uma foto (JPG, PNG, WebP) ou um PDF');

    const qt = await this.db.withCentral(ctx, (tx) => loadAiQuota(tx));
    const c = qt.config;
    if (!c.enabled || !c.api_key_enc || !this.env.INTEGRATIONS_KEY)
      throw new ServiceUnavailableException(
        'A importação com IA ainda não foi ligada pelo Comandou',
      );
    if (!c.tenant_enabled)
      throw new ServiceUnavailableException('A IA está desligada para este restaurante');
    if (qt.blocked)
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'ai_limit',
          message: 'O limite de uso da IA neste mês acabou. Fale com o suporte do Comandou.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    let apiKey: string;
    try {
      apiKey = open(this.env.INTEGRATIONS_KEY, c.api_key_enc, AI_KEY_CONTEXT);
    } catch {
      throw new ServiceUnavailableException('A chave da IA precisa ser salva de novo no painel');
    }

    const data = `data:${mime};base64,${file.toString('base64')}`;
    const attachment: ContentPart = isPdf
      ? { type: 'file', file: { filename: 'cardapio.pdf', file_data: data } }
      : { type: 'image_url', image_url: { url: data } };
    const model = this.env.AI_IMPORT_MODEL;
    const client = new OpenRouterClient(this.env.OPENROUTER_BASE_URL, apiKey);
    let result: Awaited<ReturnType<OpenRouterClient['complete']>>;
    try {
      result = await client.complete(
        model,
        [
          { role: 'system', content: PROMPT },
          {
            role: 'user',
            content: [{ type: 'text', text: 'Leia este cardápio e devolva o JSON.' }, attachment],
          },
        ],
        { json: true, maxTokens: 8000 },
      );
    } catch (e) {
      this.logger.warn(`importação do cardápio falhou: ${(e as Error).message}`);
      throw new ServiceUnavailableException(
        e instanceof OpenRouterError
          ? 'A IA não respondeu agora. Tente de novo em instantes.'
          : 'Não deu para falar com a IA. Tente de novo em instantes.',
      );
    }
    const used = await this.db.withCentral(ctx, (tx) =>
      recordAiUsage(tx, { userId: ctx.userId, model, usage: result.usage, source: 'menu_import' }),
    );
    const categories = normalizeImport(result.text);
    return {
      categories,
      items: categories.reduce((n, cat) => n + cat.items.length, 0),
      tokens: result.usage.promptTokens + result.usage.completionTokens,
      usage: {
        used: used.usedMonth,
        limit: c.monthly_tokens,
        bonus: used.bonusLeft,
        available: availableTokens(c.monthly_tokens, used.usedMonth, used.bonusLeft),
      },
    };
  }
}
