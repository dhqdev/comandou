import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Ctx } from '../common/context';
import { sniff } from '../common/file-sniff';
import { imageSize } from '../common/image-size';
import { open } from '../common/secret-box';
import { one } from '../common/sql';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { AI_KEY_CONTEXT } from '../chat/ai.service';
import { loadAiQuota, recordAiUsage, type AiConfig } from '../chat/ai-quota';
import { OpenRouterClient, OpenRouterError } from '../chat/openrouter';
import { aiPrompt, cleanPrompt, createPrompt, itemName, photoPrompts } from './ai-prompts';
import { buildDish, normalizeShape, writeGlb, type DishShape } from './dish3d';
import { jsonOf, notFood, readTips, type PhotoTips } from './item-ai';
import { MAX_MODEL_BYTES } from './models.controller';

/** Foto mandada pelo navegador (já reduzida): até 3 MB. */
export const ITEM_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type Feature = 'photo' | 'model3d';

export interface ItemAiStatus {
  /** Botão "Melhorar a foto" pode ser usado agora. */
  photo: boolean;
  /** "Fazer o 3D pela foto" com a IA (sem ela, ainda dá para montar escolhendo a forma). */
  model3d: boolean;
  /** Por que não dá (para a dica na tela); null quando está tudo certo. */
  reason: string | null;
}

/**
 * IA nas fotos e no 3D dos itens do cardápio. Liga e desliga no Super Admin › Tokens, com os
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
  private why(c: AiConfig, blocked: boolean, feature: Feature): string | null {
    if (!c.enabled || !c.api_key_enc || !this.env.INTEGRATIONS_KEY)
      return 'A IA ainda não foi ligada pelo Comandou';
    if (feature === 'photo' && !c.photo_ai_enabled)
      return 'A melhoria de foto com IA está desligada pelo Comandou';
    if (feature === 'model3d' && !c.model3d_ai_enabled)
      return 'O 3D com IA está desligado pelo Comandou';
    if (!c.tenant_enabled) return 'A IA está desligada para este restaurante';
    if (blocked) return 'O limite de uso da IA neste mês acabou';
    return null;
  }

  async status(ctx: Ctx): Promise<ItemAiStatus> {
    const qt = await this.db.withCentral(ctx, (tx) => loadAiQuota(tx));
    const photo = this.why(qt.config, qt.blocked, 'photo');
    const model3d = this.why(qt.config, qt.blocked, 'model3d');
    return { photo: !photo, model3d: !model3d, reason: photo ?? model3d };
  }

  /** Chave, interruptor do Super Admin e limite do mês conferidos; o cliente pronto. */
  private async ready(ctx: Ctx, feature: Feature) {
    const qt = await this.db.withCentral(ctx, (tx) => loadAiQuota(tx));
    const c = qt.config;
    const off = this.why(c, false, feature);
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
  private async look(
    ctx: Ctx,
    feature: Feature,
    prompt: string,
    question: string,
    dataUrl: string,
    source: 'photo_tune' | 'menu_model',
  ) {
    const { c, client } = await this.ready(ctx, feature);
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
      recordAiUsage(tx, { userId: ctx.userId, model, usage: r.usage, source }),
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
      'photo',
      analysis,
      `Item: "${name}". Olhe a foto e devolva o JSON.`,
      `data:${mime};base64,${file.toString('base64')}`,
      'photo_tune',
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
    const { c, client } = await this.ready(ctx, 'photo');
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
    const { c, client } = await this.ready(ctx, 'photo');
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

  /**
   * Item em 3D pela foto. Sem `shape`, a IA lê a forma (recipiente, ângulo, tamanho) e o servidor
   * monta o GLB com a própria foto (dish3d.ts). Com `shape` (a pessoa trocou o tipo ou o tamanho
   * na tela), monta de novo sem IA e sem gastar tokens. Não grava: a tela mostra e, se ficar bom,
   * envia pelo PUT de sempre (products/:id/model/glb).
   */
  async model3d(ctx: Ctx, productId: string, body: unknown, mime: string, shape?: unknown) {
    // A foto vira a textura do modelo: JPG ou PNG, que todo visualizador de GLB lê.
    const file = this.checkPhoto(body, mime, new Set(['image/jpeg', 'image/png']));
    const size = imageSize(file);
    if (!size) throw new UnprocessableEntityException('Não deu para ler o tamanho da foto');
    const product = await this.db.withTenant(ctx, (tx) =>
      one<{ name: string }>(tx, `SELECT name FROM products WHERE id = $1`, [productId]),
    );
    // Produto de outro restaurante é indistinguível de inexistente (404, não 403).
    if (!product) throw new NotFoundException('Produto não encontrado');
    let raw: Record<string, unknown> | null;
    let byAi = false;
    if (shape && typeof shape === 'object') raw = shape as Record<string, unknown>;
    else {
      raw = await this.look(
        ctx,
        'model3d',
        aiPrompt('item-3d'),
        `Item: "${itemName(product.name)}". Leia a forma e devolva o JSON.`,
        `data:${mime};base64,${file.toString('base64')}`,
        'menu_model',
      );
      byAi = true;
      if (notFood(raw))
        throw new UnprocessableEntityException(
          'A foto não parece ser de um prato ou bebida. Tente uma foto só do item.',
        );
    }
    const s: DishShape = normalizeShape(raw as Partial<DishShape> & Record<string, unknown>);
    const mesh = buildDish(s, size.width, size.height);
    const glb = writeGlb(
      mesh,
      { bytes: file, mime: mime as 'image/jpeg' | 'image/png' },
      product.name,
    );
    if (glb.length > MAX_MODEL_BYTES)
      throw new UnprocessableEntityException('O modelo passou de 12 MB: use uma foto menor');
    return {
      shape: s,
      byAi,
      /** Medidas do modelo pronto, em cm (para a tela mostrar). */
      size: {
        widthCm: Math.round(mesh.size.width * 1000) / 10,
        heightCm: Math.round(mesh.size.height * 1000) / 10,
      },
      bytes: glb.length,
      glb: glb.toString('base64'),
    };
  }
}
