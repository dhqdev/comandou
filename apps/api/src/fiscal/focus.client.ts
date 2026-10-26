import { Inject, Injectable } from '@nestjs/common';
import { ENV, Env } from '../config/env';

export type FocusEnvironment = 'homologacao' | 'producao';

export interface FocusResponse {
  http: number;
  body: {
    status?: string;
    status_sefaz?: string;
    mensagem_sefaz?: string;
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

  emit(e: FocusEnvironment, token: string, ref: string, payload: unknown) {
    return this.call(e, token, 'POST', `/v2/nfce?ref=${encodeURIComponent(ref)}`, payload);
  }

  get(e: FocusEnvironment, token: string, ref: string) {
    return this.call(e, token, 'GET', `/v2/nfce/${encodeURIComponent(ref)}`);
  }

  cancel(e: FocusEnvironment, token: string, ref: string, justificativa: string) {
    return this.call(e, token, 'DELETE', `/v2/nfce/${encodeURIComponent(ref)}`, { justificativa });
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
