import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { FiscalExtraService } from './fiscal-extra.service';
import { FiscalRulesService } from './fiscal-rules.service';
import { FiscalService } from './fiscal.service';

const digits = (n: string, msg: string) => z.string().regex(new RegExp(`^[0-9]{${n}}$`), msg);

const Settings = z
  .object({
    enabled: z.boolean(),
    environment: z.enum(['homologacao', 'producao']),
    cnpj: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .pipe(digits('14', 'CNPJ com 14 dígitos'))
      .nullable(),
    token: z.string().trim().min(8).max(200).regex(/^\S+$/, 'token sem espaços').nullable(),
    defaultCfop: digits('4', 'CFOP com 4 dígitos'),
    defaultCode: digits('2,3', 'CSOSN/CST com 2 ou 3 dígitos'),
    defaultNcm: digits('8', 'NCM com 8 dígitos').nullable(),
    confirmProduction: z.boolean(),
    mode: z.enum(['own', 'managed']),
    nfeEnabled: z.boolean(),
    nfceNature: z.string().trim().min(1).max(60).transform((v) => v.toUpperCase()),
    nfeNature: z.string().trim().min(1).max(60).transform((v) => v.toUpperCase()),
    additionalInfo: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .transform((v) => v || null),
    autoEmitNfce: z.boolean(),
    emailCustomer: z.boolean(),
  })
  .partial();

const cnpjField = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .pipe(digits('14', 'CNPJ com 14 dígitos'));
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const Csc = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[0-9]{1,6}$/, 'Identificador do CSC só com números'),
  csc: z.string().trim().min(16, 'CSC com pelo menos 16 caracteres').max(36),
});

const Company = z.object({
  cnpj: cnpjField,
  company: z.object({
    nome: text(120),
    nomeFantasia: optText(120),
    inscricaoEstadual: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .pipe(z.string().regex(/^[0-9]{2,14}$/, 'Inscrição estadual só com números')),
    inscricaoMunicipal: optText(20),
    regimeTributario: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    logradouro: text(120),
    numero: text(60),
    complemento: optText(60),
    bairro: text(60),
    municipio: text(60),
    uf: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'UF com 2 letras'),
    cep: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .pipe(digits('8', 'CEP com 8 dígitos')),
    email: z.string().trim().email('E-mail inválido').max(120).nullish().or(z.literal('')),
    telefone: optText(20),
    numeracao: z
      .object({
        nfceSerie: z.number().int().min(0).max(999).nullish(),
        nfceProximo: z.number().int().min(1).max(999_999_999).nullish(),
        nfeSerie: z.number().int().min(0).max(999).nullish(),
        nfeProximo: z.number().int().min(1).max(999_999_999).nullish(),
      })
      .nullish(),
  }),
  certificate: z
    .object({
      // .pfx de certificado A1 costuma ter de 3 a 10 KB; 120 KB em base64 é folga de sobra.
      base64: z
        .string()
        .max(120_000, 'Arquivo de certificado grande demais')
        .regex(/^[A-Za-z0-9+/=\s]+$/, 'Certificado inválido')
        .transform((v) => v.replace(/\s/g, '')),
      password: z.string().min(1, 'Informe a senha do certificado').max(100),
    })
    .optional(),
  csc: z.object({ homologacao: Csc.optional(), producao: Csc.optional() }).optional(),
});

const STATUSES = [
  'draft',
  'pending',
  'processing',
  'authorized',
  'rejected',
  'error',
  'cancelling',
  'cancelled',
  'discarded',
] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data AAAA-MM-DD');
const ListQuery = z.object({
  orderId: z.string().uuid().optional(),
  status: z.enum(STATUSES).optional(),
  kind: z.enum(['nfce', 'nfe']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
});
const docDigits = (n: number) =>
  z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().regex(new RegExp(`^([0-9]{${n}})?$`), `${n} dígitos`))
    .nullish()
    .transform((v) => v || null);
const Recipient = z.object({
  name: optText(60),
  cpf: docDigits(11),
  cnpj: docDigits(14),
  ie: z
    .string()
    .trim()
    .toUpperCase()
    .max(14)
    .nullish()
    .transform((v) => (v ? (v === 'ISENTO' ? v : v.replace(/\D/g, '')) : null)),
  ieIndicator: z.union([z.literal(1), z.literal(2), z.literal(9)]).nullish(),
  email: z.string().trim().email('E-mail inválido').max(120).nullish().or(z.literal('')).transform((v) => v || null),
  phone: optText(20),
  street: optText(60),
  number: optText(60),
  complement: optText(60),
  district: optText(60),
  city: optText(60),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{2})?$/, 'UF com 2 letras')
    .nullish()
    .transform((v) => v || null),
  cep: docDigits(8),
});
const NfceBody = z
  .object({ cpf: docDigits(11), cnpj: docDigits(14), name: optText(60) })
  .partial()
  .default({});
const NfeBody = z.object({ customerId: z.string().uuid().nullish() }).default({});
const DocPatch = z
  .object({
    recipient: Recipient.nullable(),
    customerId: z.string().uuid().nullable(),
    operation: z
      .object({
        nature: z.string().trim().min(1).max(60).transform((v) => v.toUpperCase()),
        purpose: z.enum(['1', '2', '3', '4']),
        presence: z.enum(['0', '1', '2', '3', '4', '5', '9']),
        finalConsumer: z.boolean(),
        freight: z.enum(['0', '1', '2', '3', '4', '9']),
        info: optText(2000),
        referencedKey: docDigits(44),
        lineRules: z.record(z.string().uuid(), z.string().uuid()),
      })
      .partial(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para atualizar');
const Discard = z.object({ reason: optText(255) }).default({ reason: null });
const Correction = z.object({
  text: z.string().trim().min(15, 'Carta de correção com pelo menos 15 caracteres').max(1000),
});
const Email = z.object({ emails: z.array(z.string().trim().email('E-mail inválido')).min(1).max(5) });
const pctField = (max = 100) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).replace(',', '.').trim())
    .pipe(z.string().regex(/^(\d{1,3})(\.\d{1,4})?$/, 'percentual inválido'))
    .refine((v) => Number(v) <= max, `até ${max}%`)
    .nullable();
const Rule = z.object({
  code: z.string().trim().max(20).nullish().transform((v) => (v ? v.toUpperCase() : undefined)),
  name: text(80),
  scope: z.enum(['all', 'nfce', 'nfe']),
  active: z.boolean(),
  isDefault: z.boolean(),
  cfop: digits('4', 'CFOP com 4 dígitos'),
  cfopInterstate: digits('4', 'CFOP com 4 dígitos').nullable(),
  icmsCst: digits('2,3', 'CST com 2 dígitos ou CSOSN com 3'),
  icmsOrigin: z.number().int().min(0).max(8),
  icmsRate: pctField(),
  icmsBaseReduction: pctField(),
  pisCst: digits('2', 'CST do PIS com 2 dígitos'),
  pisRate: pctField(),
  cofinsCst: digits('2', 'CST da COFINS com 2 dígitos'),
  cofinsRate: pctField(),
  ipiCst: digits('2', 'CST do IPI com 2 dígitos').nullable(),
  ipiRate: pctField(),
  ibsCbsCst: digits('3', 'CST do IBS/CBS com 3 dígitos').nullable(),
  ibsCbsClass: digits('6', 'Classificação tributária com 6 dígitos').nullable(),
  cbsRate: pctField(),
  ibsUfRate: pctField(),
  ibsMunRate: pctField(),
  benefitCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{8,10}$/, 'cBenef com 8 a 10 letras/números')
    .nullable(),
  approxTaxRate: pctField(),
  notes: optText(500),
});
const RuleCreate = Rule.partial().required({ name: true, cfop: true, icmsCst: true });
const RulePatch = Rule.partial().refine((o) => Object.keys(o).length > 0, 'nada para atualizar');
const NcmRule = z.object({ ruleId: z.string().uuid().nullable() });
const ncmParam = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .pipe(digits('8', 'NCM com 8 dígitos'));
const VoidBody = z.object({
  kind: z.enum(['nfce', 'nfe']),
  series: z.coerce.number().int().min(0).max(999),
  from: z.coerce.number().int().min(1).max(999_999_999),
  to: z.coerce.number().int().min(1).max(999_999_999),
  reason: z.string().trim().min(15, 'Justificativa com pelo menos 15 caracteres').max(255),
});
const Manifest = z.object({
  tipo: z.enum(['ciencia', 'confirmacao', 'desconhecimento', 'nao_realizada']),
  reason: optText(255),
});
const Cancel = z.object({
  // A SEFAZ exige justificativa de 15 a 255 caracteres.
  reason: z.string().trim().min(15, 'Justificativa com pelo menos 15 caracteres').max(255),
});

/** Nota fiscal ao consumidor (NFC-e). O restaurante vem sempre do Host, nunca do corpo. */
@Controller({ version: '1' })
export class FiscalController {
  constructor(
    private readonly fiscal: FiscalService,
    private readonly rules: FiscalRulesService,
    private readonly extra: FiscalExtraService,
  ) {}

  @Get('fiscal/settings')
  @RequirePermission('fiscal:manage')
  settings(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.fiscal.getSettings(ctxOf(t, u));
  }

  @Put('fiscal/settings')
  @RequirePermission('fiscal:manage')
  save(
    @Body(new ZodPipe(Settings)) b: z.infer<typeof Settings>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.fiscal.saveSettings(ctxOf(t, u, req), b);
  }

  /** Cadastro guiado: envia empresa, certificado A1 e CSC para a Focus NFe (modo revenda). */
  @Put('fiscal/company')
  @RequirePermission('fiscal:manage')
  company(
    @Body(new ZodPipe(Company)) b: z.infer<typeof Company>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.fiscal.saveCompany(ctxOf(t, u, req), {
      ...b,
      company: { ...b.company, email: b.company.email || null },
    });
  }

  @Get('fiscal/cnpj/:cnpj')
  @RequirePermission('fiscal:manage')
  cnpj(@Param('cnpj', new ZodPipe(cnpjField)) cnpj: string) {
    return this.fiscal.lookupCnpj(cnpj);
  }

  @Get('fiscal/documents')
  @RequirePermission('fiscal:emit', 'fiscal:manage')
  list(
    @Query(new ZodPipe(ListQuery)) f: z.infer<typeof ListQuery>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.fiscal.list(ctxOf(t, u), f);
  }

  @Get('fiscal/documents/:id')
  @RequirePermission('fiscal:emit', 'fiscal:manage')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('full') full: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return full ? this.fiscal.detail(ctxOf(t, u), id) : this.fiscal.get(ctxOf(t, u), id);
  }

  /** Pede a NFC-e do pedido (com CPF na nota, se o cliente quiser). Repetir devolve a mesma nota. */
  @Post('orders/:id/nfce')
  @HttpCode(202)
  @RequirePermission('fiscal:emit')
  emit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(NfceBody)) b: z.infer<typeof NfceBody>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.fiscal.request(ctxOf(t, u, req), id, b ?? {});
  }

  /** Abre a NF-e do pedido como rascunho (destinatário e operação editáveis antes de emitir). */
  @Post('orders/:id/nfe')
  @HttpCode(201)
  @RequirePermission('fiscal:emit')
  createNfe(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(NfeBody)) b: z.infer<typeof NfeBody>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.fiscal.createNfe(ctxOf(t, u, req), id, b ?? {});
  }

  /** Corrige destinatário/operação de uma nota em rascunho, rejeitada ou com erro. */
  @Patch('fiscal/documents/:id')
  @RequirePermission('fiscal:emit')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(DocPatch)) b: z.infer<typeof DocPatch>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.fiscal.update(ctxOf(t, u, req), id, b);
  }

  /** Emite o rascunho ou reemite a nota rejeitada/com erro (mesma referência, mesmo número). */
  @Post('fiscal/documents/:id/reissue')
  @HttpCode(202)
  @RequirePermission('fiscal:emit')
  reissue(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.fiscal.reissue(ctxOf(t, u), id);
  }

  /** Apaga (descarta) nota não autorizada. Autorizada só se cancela. */
  @Post('fiscal/documents/:id/discard')
  @HttpCode(200)
  @RequirePermission('fiscal:emit')
  discard(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Discard)) b: z.infer<typeof Discard>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.fiscal.discard(ctxOf(t, u, req), id, b?.reason ?? null);
  }

  @Post('fiscal/documents/:id/correction')
  @HttpCode(200)
  @RequirePermission('fiscal:emit')
  correction(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Correction)) b: z.infer<typeof Correction>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.fiscal.correction(ctxOf(t, u, req), id, b.text);
  }

  @Post('fiscal/documents/:id/email')
  @HttpCode(200)
  @RequirePermission('fiscal:emit')
  email(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Email)) b: z.infer<typeof Email>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.fiscal.email(ctxOf(t, u), id, b.emails);
  }

  // ---------------------------------------------------------------- padrões fiscais
  @Get('fiscal/rules')
  @RequirePermission('fiscal:emit', 'fiscal:manage', 'catalog:read')
  listRules(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.rules.list(ctxOf(t, u));
  }

  @Post('fiscal/rules')
  @RequirePermission('fiscal:manage')
  createRule(
    @Body(new ZodPipe(RuleCreate)) b: z.infer<typeof RuleCreate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.rules.save(ctxOf(t, u, req), null, b);
  }

  /** Cria os padrões sugeridos para o regime da empresa. */
  @Post('fiscal/rules/suggested')
  @HttpCode(200)
  @RequirePermission('fiscal:manage')
  async suggested(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const s = await this.fiscal.getSettings(ctxOf(t, u));
    return this.rules.createSuggested(ctxOf(t, u, req), s.regime);
  }

  @Patch('fiscal/rules/:id')
  @RequirePermission('fiscal:manage')
  updateRule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(RulePatch)) b: z.infer<typeof RulePatch>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.rules.save(ctxOf(t, u, req), id, b);
  }

  @Delete('fiscal/rules/:id')
  @RequirePermission('fiscal:manage')
  deleteRule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.rules.remove(ctxOf(t, u, req), id);
  }

  @Put('fiscal/ncm-rules/:ncm')
  @RequirePermission('fiscal:manage')
  setNcm(
    @Param('ncm', new ZodPipe(ncmParam)) ncm: string,
    @Body(new ZodPipe(NcmRule)) b: z.infer<typeof NcmRule>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.rules.setNcm(ctxOf(t, u, req), ncm, b.ruleId);
  }

  @Get('fiscal/ncm')
  @RequirePermission('fiscal:emit', 'fiscal:manage', 'catalog:read')
  ncms(
    @Query('q') query: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.extra.ncms(ctxOf(t, u), (query ?? '').slice(0, 60));
  }

  // ---------------------------------------------------------------- inutilização
  @Get('fiscal/voids')
  @RequirePermission('fiscal:emit', 'fiscal:manage')
  voids(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.extra.listVoids(ctxOf(t, u));
  }

  @Get('fiscal/voids/gaps')
  @RequirePermission('fiscal:emit', 'fiscal:manage')
  gaps(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.extra.gaps(ctxOf(t, u));
  }

  @Post('fiscal/voids')
  @RequirePermission('fiscal:manage')
  createVoid(
    @Body(new ZodPipe(VoidBody)) b: z.infer<typeof VoidBody>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.extra.createVoid(ctxOf(t, u, req), b);
  }

  // ---------------------------------------------------------------- notas recebidas
  @Get('fiscal/received')
  @RequirePermission('fiscal:emit', 'fiscal:manage', 'stock:read')
  received(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.extra.listReceived(ctxOf(t, u));
  }

  @Post('fiscal/received/sync')
  @HttpCode(200)
  @RequirePermission('fiscal:emit', 'fiscal:manage')
  syncReceived(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.extra.syncReceived(ctxOf(t, u));
  }

  @Post('fiscal/received/:id/manifest')
  @HttpCode(200)
  @RequirePermission('fiscal:manage')
  manifest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Manifest)) b: z.infer<typeof Manifest>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.extra.manifest(ctxOf(t, u, req), id, b.tipo, b.reason ?? null);
  }

  @Get('fiscal/received/:id/file')
  @RequirePermission('fiscal:emit', 'fiscal:manage', 'stock:read')
  async receivedFile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('ext', new ZodPipe(z.enum(['xml', 'pdf']))) ext: 'xml' | 'pdf',
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const f = await this.extra.receivedFile(ctxOf(t, u), id, ext);
    res.setHeader('Content-Type', f.type);
    res.setHeader('Content-Disposition', `inline; filename="${f.name}"`);
    res.send(f.data);
  }

  @Post('fiscal/documents/:id/sync')
  @HttpCode(202)
  @RequirePermission('fiscal:emit')
  sync(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.fiscal.sync(ctxOf(t, u), id);
  }

  @Post('fiscal/documents/:id/cancel')
  @HttpCode(200)
  @RequirePermission('fiscal:emit')
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Cancel)) b: z.infer<typeof Cancel>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.fiscal.cancel(ctxOf(t, u, req), id, b.reason);
  }
}
