import { Inject, Injectable } from '@nestjs/common';
import { ENV, Env } from '../config/env';

export type FocusEnvironment = 'homologacao' | 'producao';
export type FiscalKind = 'nfce' | 'nfe';

/** Uma NF-e recebida (emitida por um fornecedor contra o CNPJ do restaurante). */
export interface FocusReceived {
  nome_emitente?: string;
  documento_emitente?: string;
  chave_nfe: string;
  valor_total?: string;
  data_emissao?: string;
  situacao?: string;
  manifestacao_destinatario?: string | null;
  nfe_completa?: boolean | string;
  tipo_nfe?: string;
  versao?: number;
  carta_correcao?: string | null;
  data_cancelamento?: string | null;
  justificativa_cancelamento?: string | null;
}

export interface FocusResponse {
  http: number;
  body: {
    status?: string;
    status_sefaz?: string | number;
    mensagem_sefaz?: string;
    protocolo?: string;
    protocolo_sefaz?: string | number;
    caminho_xml?: string;
    caminho_xml_carta_correcao?: string;
    caminho_pdf_carta_correcao?: string;
    numero_carta_correcao?: number;
    chave_nfe?: string;
    numero?: string;
    serie?: string;
    caminho_xml_nota_fiscal?: string;
    caminho_danfe?: string;
    qrcode_url?: string;
    codigo?: string;
    mensagem?: string;
    erros?: { mensagem?: string; campo?: string }[];
  };
}

/** Resposta da API de empresas e da consulta de CNPJ (só os campos usados). */
export interface FocusCompanyBody {
  id?: number | string;
  token_producao?: string | null;
  token_homologacao?: string | null;
  certificado_valido_ate?: string | null;
  certificado_cnpj?: string | null;
  codigo?: string;
  mensagem?: string;
  erros?: { mensagem?: string; campo?: string }[];
  // consulta de CNPJ
  razao_social?: string;
  optante_simples_nacional?: boolean;
  optante_mei?: boolean;
  endereco?: {
    logradouro?: string;
    tipo_logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    nome_municipio?: string;
    uf?: string;
    cep?: string;
  };
}

/** Erro de rede/servidor da Focus: o trabalho deve ser tentado de novo. */
export class FocusUnavailableError extends Error {}

/**
 * Cliente mínimo da API v2 da Focus NFe (NFC-e).
 * Autenticação: Basic com o token como usuário e senha vazia.
 * Docs: https://doc.focusnfe.com.br/reference/emitir_nfce
 */
@Injectable()
export class FocusClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  private base(e: FocusEnvironment) {
    return (
      e === 'producao' ? this.env.FOCUS_NFE_URL_PRODUCAO : this.env.FOCUS_NFE_URL_HOMOLOGACAO
    ).replace(/\/+$/, '');
  }

  private async call(
    e: FocusEnvironment,
    token: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<FocusResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.base(e)}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new FocusUnavailableError(`Focus NFe indisponível: ${(err as Error).message}`);
    }
    if (res.status >= 500 || res.status === 429)
      throw new FocusUnavailableError(`Focus NFe respondeu ${res.status}`);
    const json = (await res.json().catch(() => ({}))) as FocusResponse['body'];
    return { http: res.status, body: json };
  }

  emit(e: FocusEnvironment, token: string, ref: string, payload: unknown, kind: FiscalKind = 'nfce') {
    return this.call(e, token, 'POST', `/v2/${kind}?ref=${encodeURIComponent(ref)}`, payload);
  }

  get(e: FocusEnvironment, token: string, ref: string, kind: FiscalKind = 'nfce') {
    return this.call(e, token, 'GET', `/v2/${kind}/${encodeURIComponent(ref)}`);
  }

  cancel(
    e: FocusEnvironment,
    token: string,
    ref: string,
    justificativa: string,
    kind: FiscalKind = 'nfce',
  ) {
    return this.call(e, token, 'DELETE', `/v2/${kind}/${encodeURIComponent(ref)}`, {
      justificativa,
    });
  }

  /** Inutiliza uma faixa de numeração (síncrono). */
  voidRange(
    e: FocusEnvironment,
    token: string,
    kind: FiscalKind,
    body: {
      cnpj: string;
      serie: string;
      numero_inicial: string;
      numero_final: string;
      justificativa: string;
    },
  ) {
    return this.call(e, token, 'POST', `/v2/${kind}/inutilizacao`, body);
  }

  /** Carta de correção da NF-e (síncrono). */
  correction(e: FocusEnvironment, token: string, ref: string, correcao: string) {
    return this.call(e, token, 'POST', `/v2/nfe/${encodeURIComponent(ref)}/carta_correcao`, {
      correcao,
    });
  }

  /** Envia DANFE e XML por e-mail (a Focus manda). */
  email(e: FocusEnvironment, token: string, ref: string, emails: string[], kind: FiscalKind) {
    return this.call(e, token, 'POST', `/v2/${kind}/${encodeURIComponent(ref)}/email`, { emails });
  }

  /** NF-e emitidas contra o CNPJ (fornecedores), a partir de uma versão. Até 100 por chamada. */
  async received(e: FocusEnvironment, token: string, cnpj: string, versao: number) {
    const r = await this.raw(
      e,
      token,
      `/v2/nfes_recebidas?cnpj=${encodeURIComponent(cnpj)}&versao=${versao}`,
    );
    const body = (await r.json().catch(() => [])) as unknown;
    return {
      http: r.status,
      rows: Array.isArray(body) ? (body as FocusReceived[]) : [],
      error: Array.isArray(body) ? null : (body as FocusResponse['body']),
      maxVersion: Number(r.headers.get('x-max-version') ?? 0) || 0,
      total: Number(r.headers.get('x-total-count') ?? 0) || 0,
    };
  }

  /** Manifestação do destinatário (ciência, confirmação, desconhecimento, não realizada). */
  manifest(
    e: FocusEnvironment,
    token: string,
    key: string,
    tipo: string,
    justificativa?: string,
  ) {
    return this.call(e, token, 'POST', `/v2/nfes_recebidas/${encodeURIComponent(key)}/manifesto`, {
      tipo,
      ...(justificativa ? { justificativa } : {}),
    });
  }

  /** Arquivo de uma nota recebida (XML ou DANFE em PDF), que exige o token para baixar. */
  async receivedFile(e: FocusEnvironment, token: string, key: string, ext: 'xml' | 'pdf') {
    const r = await this.raw(e, token, `/v2/nfes_recebidas/${encodeURIComponent(key)}.${ext}`);
    if (r.status >= 400) return null;
    return {
      type: r.headers.get('content-type') ?? (ext === 'xml' ? 'application/xml' : 'application/pdf'),
      data: Buffer.from(await r.arrayBuffer()),
    };
  }

  /** Busca de NCM na tabela da Focus (código ou descrição). */
  async ncms(e: FocusEnvironment, token: string, query: string) {
    const isCode = /^[0-9.]+$/.test(query);
    const qs = isCode
      ? `codigo=${encodeURIComponent(query.replace(/\D/g, ''))}`
      : `descricao=${encodeURIComponent(query)}`;
    const r = await this.raw(e, token, `/v2/ncms?${qs}`);
    if (r.status >= 400) return [];
    const body = (await r.json().catch(() => [])) as { codigo?: string; descricao_completa?: string; descricao?: string }[];
    return Array.isArray(body) ? body : [];
  }

  /** GET devolvendo a resposta crua (cabeçalhos, arquivos). */
  private async raw(e: FocusEnvironment, token: string, path: string) {
    let res: Response;
    try {
      res = await fetch(`${this.base(e)}${path}`, {
        headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new FocusUnavailableError(`Focus NFe indisponível: ${(err as Error).message}`);
    }
    if (res.status >= 500 || res.status === 429)
      throw new FocusUnavailableError(`Focus NFe respondeu ${res.status}`);
    return res;
  }

  // ---------------------------------------------------------------- empresas (modo revenda)
  // A API de empresas só existe no servidor de produção e usa o token master da conta.
  // Docs: https://doc.focusnfe.com.br/reference/criar_empresa

  /** Há token master configurado no servidor (modo revenda disponível)? */
  get masterAvailable() {
    return !!this.env.FOCUS_NFE_MASTER_TOKEN;
  }

  private master() {
    if (!this.env.FOCUS_NFE_MASTER_TOKEN) throw new Error('FOCUS_NFE_MASTER_TOKEN ausente');
    return this.env.FOCUS_NFE_MASTER_TOKEN;
  }

  createCompany(payload: Record<string, unknown>) {
    return this.callCompany('POST', '/v2/empresas', payload);
  }

  updateCompany(id: string, payload: Record<string, unknown>) {
    return this.callCompany('PUT', `/v2/empresas/${encodeURIComponent(id)}`, payload);
  }

  /** Dados públicos do CNPJ (razão social e endereço) para preencher o cadastro. */
  lookupCnpj(cnpj: string) {
    return this.callCompany('GET', `/v2/cnpjs/${encodeURIComponent(cnpj)}`);
  }

  private async callCompany(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<{ http: number; body: FocusCompanyBody }> {
    const r = await this.call('producao', this.master(), method, path, body);
    return r as { http: number; body: FocusCompanyBody };
  }

  /** URL absoluta de um arquivo devolvido pela Focus (XML/DANFE vêm como caminho relativo). */
  fileUrl(e: FocusEnvironment, path: string | null) {
    if (!path) return null;
    return /^https?:\/\//.test(path) ? path : `${this.base(e)}${path}`;
  }
}
