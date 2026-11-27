/**
 * Modelos de IA do Comandou e para que serve cada um (pedido do David, 0.269: "o mais barato para
 * o chat; para o resto, o que for melhor"). O Super Admin troca cada um em Tokens de IA › Chaves e
 * assistente; estes são os padrões e as reservas. Preços do OpenRouter (US$ por 1 milhão de
 * tokens, entrada / saída) conferidos em novembro de 2026.
 */

/**
 * Conversa (chat da equipe, IA do WhatsApp, modelo de impressão, texto da página): DeepSeek V4
 * Flash, US$ 0,05 / 0,45. Metade da entrada do Gemini 2.5 Flash Lite (0,10 / 0,40), e a conversa
 * gasta quase tudo em entrada (o guia do sistema vai em toda pergunta); a parte repetida ainda
 * sai pelo preço do cache.
 */
export const CHAT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Reserva da conversa: outro provedor. Se o DeepSeek estiver fora do ar ou recusar, o OpenRouter
 * responde com este na mesma chamada (a pessoa nem percebe) e o uso fica com o nome dele.
 */
export const CHAT_FALLBACK_MODEL = 'google/gemini-2.5-flash-lite';

/** Olhar a foto do item (melhorar a foto, 3D): o mais barato que lê imagem com JSON confiável. */
export const VISION_MODEL = 'google/gemini-2.5-flash-lite';

/** Refazer o fundo e criar a foto do item, pela API de imagens (~US$ 0,014 por foto). */
export const IMAGE_MODEL = 'openai/gpt-image-2';

/**
 * Ler o cardápio (PDF, foto, link) e achar o restaurante no Google: Gemini 2.5 Flash (0,30 / 2,50).
 * Mais caro, mas é uma vez por restaurante e errar preço do cardápio inteiro custa mais caro.
 */
export const IMPORT_MODEL = 'google/gemini-2.5-flash';

/** Modelos de reserva da conversa para o modelo escolhido (nenhum se já for a reserva). */
export function chatFallbacks(model: string): string[] {
  return model === CHAT_FALLBACK_MODEL ? [] : [CHAT_FALLBACK_MODEL];
}

/**
 * Preço de referência e o porquê de cada modelo padrão, para os cartões "Modelos em uso" do
 * Super Admin quando a lista do OpenRouter ainda não carregou (ou não traz o modelo de imagem).
 * US$ por 1 milhão de tokens, conferidos no OpenRouter em novembro de 2026.
 */
export const MODEL_NOTES: Record<
  string,
  {
    name: string;
    promptPerM?: number;
    completionPerM?: number;
    priceNote?: string;
    why: string;
  }
> = {
  [CHAT_MODEL]: {
    name: 'DeepSeek V4 Flash',
    promptPerM: 0.05,
    completionPerM: 0.45,
    why: 'O mais barato que conversa bem em português; a parte repetida da pergunta sai pelo preço do cache.',
  },
  [CHAT_FALLBACK_MODEL]: {
    name: 'Gemini 2.5 Flash Lite',
    promptPerM: 0.1,
    completionPerM: 0.4,
    why: 'Barato, rápido e de outro provedor: segura a conversa quando o principal cai, e lê foto.',
  },
  [IMAGE_MODEL]: {
    name: 'GPT Image 2',
    priceNote: '~US$ 0,014 por foto',
    why: 'Refaz o fundo e cria a foto do item com boa qualidade pelo menor preço por imagem.',
  },
  [IMPORT_MODEL]: {
    name: 'Gemini 2.5 Flash',
    promptPerM: 0.3,
    completionPerM: 2.5,
    why: 'Lê PDF, foto e link do cardápio com precisão; é uma vez por restaurante, então vale pagar mais.',
  },
};
