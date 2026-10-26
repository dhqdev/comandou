import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
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

const ListQuery = z.object({
  orderId: z.string().uuid().optional(),
  status: z
    .enum(['pending', 'processing', 'authorized', 'rejected', 'error', 'cancelling', 'cancelled'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const Cancel = z.object({
  // A SEFAZ exige justificativa de 15 a 255 caracteres.
  reason: z.string().trim().min(15, 'Justificativa com pelo menos 15 caracteres').max(255),
});

/** Nota fiscal ao consumidor (NFC-e). O restaurante vem sempre do Host, nunca do corpo. */
@Controller({ version: '1' })
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

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
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.fiscal.get(ctxOf(t, u), id);
  }

  /** Pede a NFC-e do pedido. Repetir devolve a mesma nota (não emite duas). */
  @Post('orders/:id/nfce')
  @HttpCode(202)
  @RequirePermission('fiscal:emit')
  emit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.fiscal.request(ctxOf(t, u, req), id);
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
