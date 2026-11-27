import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Ctx } from '../common/context';
import { sniff } from '../common/file-sniff';
import { open } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { AI_KEY_CONTEXT } from '../chat/ai.service';
import { loadAiQuota, recordAiUsage, type AiConfig } from '../chat/ai-quota';
import { OpenRouterClient, OpenRouterError } from '../chat/openrouter';
import { aiPrompt, cleanPrompt, createPrompt, itemName, photoPrompts } from './ai-prompts';
import { jsonOf, readTips, type PhotoTips } from './item-ai';

/** Foto mandada pelo navegador (já reduzida): até 3 MB. */
export const ITEM_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface ItemAiStatus {
  /** Botão "Melhorar a foto" pode ser usado agora. */
  photo: boolean;
  /** Por que não dá (para a dica na tela); null quando está tudo certo. */
  reason: string | null;
}

/**
 * IA nas fotos dos itens do cardápio. Liga e desliga no Super Admin › Tokens, com os
 * modelos escolhidos lá (os mais baratos por padrão), e todo uso desconta dos tokens do
 * restaurante, como o resto da IA. Os textos que guiam a IA estão em apps/api/assets/ai/*.md.
 */
@Injectable()
export class ItemAiService {
  private readonly logger = new Logger(ItemAiService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** O que falta para usar (sem lançar erro), para a tela mostrar ou esconder os botões. */
  private why(c: AiConfig, blocked: boolean): string | null {
    if (!c.enabled || !c.api_key_enc || !this.env.INTEGRATIONS_KEY)
      return 'A IA ainda não foi ligada pelo Comandou';
    if (!c.photo_ai_enabled) return 'A melhoria de foto com IA está desligada pelo Comandou';
    if (!c.tenant_enabled) return 'A IA está desligada para este restaurante';
    if (blocked) return 'O limite de uso da IA neste mês acabou';
    return null;
  }

  async status(ctx: Ctx): Promise<ItemAiStatus> {
    const qt = await this.db.withCentral(ctx, (tx) => loadAiQuota(tx));
    const photo = this.why(qt.config, qt.blocked);
    return { photo: !photo, reason: photo };
  }

  /** Chave, interruptor do Super Admin e limite do mês conferidos; o cliente pronto. */
  private async ready(ctx: Ctx) {
    const qt = await this.db.withCentral(ctx, (tx) => loadAiQuota(tx));
    const c = qt.config;
    const off = this.why(c, false);
    if (off) throw new ServiceUnavailableException(off);
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
      apiKey = open(this.env.INTEGRATIONS_KEY!, c.api_key_enc!, AI_KEY_CONTEXT);
    } catch {
      throw new ServiceUnavailableException('A chave da IA precisa ser salva de novo no painel');
    }
    return { c, client: new OpenRouterClient(this.env.OPENROUTER_BASE_URL, apiKey) };
  }

  private checkPhoto(file: unknown, mime: string, types = PHOTO_TYPES): Buffer {
    if (!Buffer.isBuffer(file) || file.length === 0)
      throw new UnprocessableEntityException('Envie a foto do item');
    if (file.length > ITEM_PHOTO_MAX_BYTES)
      throw new UnprocessableEntityException('Foto maior que 3 MB');
    if (!types.has(mime) || sniff(file) !== mime)
      throw new UnprocessableEntityException(
        types.has('image/webp') ? 'Envie uma foto JPG, PNG ou WebP' : 'Envie a foto em JPG ou PNG',
      );
    return file;
  }

  /** A foto olhada pelo modelo barato de visão: devolve o JSON da resposta. */
  private async look(ctx: Ctx, prompt: string, question: string, dataUrl: string) {
    const { c, client } = await this.ready(ctx);
    const model = c.vision_model;
    let r: Awaited<ReturnType<OpenRouterClient['complete']>>;
    try {
      r = await client.complete(
        model,
        [
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: question },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        { json: true, maxTokens: 900, signal: AbortSignal.timeout(60_000) },
      );
    } catch (e) {
      this.logger.warn(`IA da foto do item falhou: ${(e as Error).message}`);
      throw new ServiceUnavailableException(
        e instanceof OpenRouterError && e.status === 402
          ? 'A IA está sem saldo agora. Fale com o suporte do Comandou.'
          : 'A IA não respondeu agora. Tente de novo em instantes.',
      );
    }
    await this.db.withCentral(ctx, (tx) =>
      recordAiUsage(tx, {
        userId: ctx.userId,
        model: r.model,
        usage: r.usage,
        source: 'photo_tune',
      }),
    );
    return jsonOf(r.text);
  }

  /** "Melhorar a foto": a IA olha e sugere um retoque leve (aplicado no navegador) e dicas. */
  async photoTips(ctx: Ctx, body: unknown, mime: string, item: string): Promise<PhotoTips> {
    const file = this.checkPhoto(body, mime);
    const { analysis } = photoPrompts(aiPrompt('melhorar-foto'));
    const name = itemName(item);
    const raw = await this.look(
      ctx,
      analysis,
      `Item: "${name}". Olhe a foto e devolva o JSON.`,
      `data:${mime};base64,${file.toString('base64')}`,
    );
    return readTips(raw);
  }

  /**
   * Foto com fundo limpo: a IA de imagem refaz só o fundo e a luz (o pedido está no
   * melhorar-foto.md). Usa a API de imagens do OpenRouter com o modelo do Super Admin; se ele
   * não aceitar edição por lá, cai no modelo de imagem do sistema (AI_IMAGE_MODEL).
   */
  async photoClean(ctx: Ctx, body: unknown, mime: string, item: string) {
    const file = this.checkPhoto(body, mime);
    const { c, client } = await this.ready(ctx);
    const prompt = cleanPrompt(photoPrompts(aiPrompt('melhorar-foto')).clean, item);
    if (!prompt)
      throw new ServiceUnavailableException('O pedido do fundo limpo não foi encontrado');
    const input = `data:${mime};base64,${file.toString('base64')}`;
    let model = c.image_model;
    let r: Awaited<ReturnType<OpenRouterClient['editImage']>>;
    try {
      try {
        r = await client.editImage(model, prompt, input);
      } catch (e) {
        // Modelo sem edição pela API de imagens (ou API fora): tenta o de sempre do sistema.
        if (!(e instanceof OpenRouterError) || ![400, 404, 405, 422].includes(e.status)) throw e;
        this.logger.warn(`edição pela API de imagens recusada (${e.message}); tentando o outro`);
        model = this.env.AI_IMAGE_MODEL;
        r = await client.image(model, prompt, { input });
      }
    } catch (e) {
      this.logger.warn(`foto com fundo limpo falhou: ${(e as Error).message}`);
      throw new ServiceUnavailableException('A IA não conseguiu refazer a foto agora');
    }
    await this.db.withCentral(ctx, (tx) =>
      recordAiUsage(tx, { userId: ctx.userId, model, usage: r.usage, source: 'photo_clean' }),
    );
    const out = sniff(r.bytes);
    if (!out) throw new ServiceUnavailableException('A IA devolveu uma foto que não deu para ler');
    return { mime: out, body: r.bytes };
  }

  /**
   * "Criar foto com IA" ao escolher a foto do item: a IA de imagem faz a foto do zero pelo nome e
   * pela descrição (o pedido está no criar-foto.md). Mesmo interruptor e modelo do fundo limpo; se
   * o modelo não criar pela API de imagens, cai no modelo de imagem do sistema. Não grava: a tela
   * mostra e, se ficar boa, envia como uma foto qualquer.
   */
  async photoCreate(ctx: Ctx, item: string, description: string) {
    if (!item.trim()) throw new UnprocessableEntityException('Dê um nome ao item antes');
    const { c, client } = await this.ready(ctx);
    const prompt = createPrompt(aiPrompt('criar-foto'), item, description);
    let model = c.image_model;
    let r: Awaited<ReturnType<OpenRouterClient['editImage']>>;
    try {
      try {
        r = await client.editImage(model, prompt, null);
      } catch (e) {
        if (!(e instanceof OpenRouterError) || ![400, 404, 405, 422].includes(e.status)) throw e;
        this.logger.warn(`criar pela API de imagens recusado (${e.message}); tentando o outro`);
        model = this.env.AI_IMAGE_MODEL;
        r = await client.image(model, prompt);
      }
    } catch (e) {
      this.logger.warn(`foto criada pela IA falhou: ${(e as Error).message}`);
      throw new ServiceUnavailableException(
        e instanceof OpenRouterError && e.status === 402
          ? 'A IA está sem saldo agora. Fale com o suporte do Comandou.'
          : 'A IA não conseguiu criar a foto agora. Tente de novo em instantes.',
      );
    }
    await this.db.withCentral(ctx, (tx) =>
      recordAiUsage(tx, { userId: ctx.userId, model, usage: r.usage, source: 'photo_create' }),
    );
    const out = sniff(r.bytes);
    if (!out || !PHOTO_TYPES.has(out))
      throw new ServiceUnavailableException('A IA devolveu uma foto que não deu para ler');
    return { mime: out, body: r.bytes };
  }
}
