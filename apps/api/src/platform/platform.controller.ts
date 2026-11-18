import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public, SkipTenant } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, Env } from '../config/env';
import {
  PLATFORM_COOKIE,
  PLATFORM_COOKIE_PATH,
  platformCookieOptions,
  PLATFORM_DEVICE_COOKIE,
  PlatformAuthService,
  PlatformHostGuard,
  PlatformSessionGuard,
} from './platform-auth';
import {
  BackupRunRequest,
  BackupSettingsBody,
  LoginInput,
  NewPlan,
  NewTenant,
  PlanBody,
  RenameTenant,
  TenantProfileBody,
  ResetPassword,
  RevokeSessions,
  ServerCleanup,
  VmAction,
  VmJobId,
  ServiceName,
  SystemUpdate,
  TenantUpdateSchedule,
  StatusChange,
  DeleteTenant,
  DbServerBody,
  DbServerUpdate,
  TransferAll,
  TransferDatabase,
  NewMigration,
  ReceiverBody,
  StackBody,
  SubscriptionChange,
  SupportAccess,
} from './platform.schemas';
import { Actor, PlatformService } from './platform.service';
import { PlatformBackupService } from './platform-backup.service';
import {
  AiSettingsBody,
  AiTestBody,
  PlatformAiService,
  TenantAiBody,
  TokenGrantBody,
} from './platform-ai.service';
import { PlatformDatabasesService } from './platform-databases.service';
import { PlatformPasswordResetService } from './platform-password-reset.service';
import { RESET_REQUEST_LIMIT, RESET_STEP_LIMIT } from '../auth/reset-code';
import { PlatformDbServersService } from './platform-db-servers.service';
import { PlatformDb, platformAudit } from './platform-db.service';
import { ReleaseFeed, ServerAgentClient } from './server-agent.service';
import { BillingService } from '../billing/billing.service';
import { PlatformSitesService } from './platform-sites.service';
import { PlatformMigrationsService } from './platform-migrations.service';
import { PlatformReceiveService } from './platform-receive.service';
import { PlatformVersionsService } from './platform-versions.service';
import { CHUNK_LIMIT, type Manifest } from '../migration/protocol';
import { CepService } from '../store/cep.service';
import {
  KitchenDisplayBody,
  KitchenSectorBody,
  PlatformKitchenService,
} from './platform-kitchen.service';

const actor = (req: Request): Actor => ({ admin: req.platformAdmin!, ip: req.ip });

const ResetRequest = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const ResetVerify = ResetRequest.extend({ code: z.string().trim().min(6).max(12) });
const ResetComplete = z.object({
  token: z.string().min(20).max(100),
  password: z.string().min(10, 'mínimo de 10 caracteres').max(200),
});

/** Login do painel: só em admin.<domínio base>, com senha e código do autenticador. */
@Controller({ path: 'platform/auth', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard)
export class PlatformAuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly auth: PlatformAuthService,
    private readonly resets: PlatformPasswordResetService,
  ) {}

  /** Esqueci minha senha: manda o código (mesma resposta exista o e-mail ou não). */
  @Post('password-reset/request')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: RESET_REQUEST_LIMIT } })
  requestReset(
    @Body(new ZodPipe(ResetRequest)) b: z.infer<typeof ResetRequest>,
    @Req() req: Request,
  ) {
    return this.resets.request(b.email, req.ip);
  }

  @Post('password-reset/verify')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: RESET_STEP_LIMIT } })
  verifyReset(@Body(new ZodPipe(ResetVerify)) b: z.infer<typeof ResetVerify>) {
    return this.resets.verify(b.email, b.code);
  }

  /** Grava a senha nova. O login continua pedindo o código do autenticador. */
  @Post('password-reset/complete')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: RESET_STEP_LIMIT } })
  completeReset(
    @Body(new ZodPipe(ResetComplete)) b: z.infer<typeof ResetComplete>,
    @Req() req: Request,
  ) {
    return this.resets.complete(b.token, b.password, req.ip);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({
    default: {
      ttl: 60_000,
      limit: (ctx) => ctx.switchToHttp().getRequest<Request>().app.locals.loginRateLimit ?? 5,
    },
  })
  async login(
    @Body(new ZodPipe(LoginInput)) b: z.infer<typeof LoginInput>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.login(b.email, b.password, b.code, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      deviceToken: this.deviceCookie(req),
      remember: b.remember,
    });
    res.cookie(PLATFORM_COOKIE, r.token, platformCookieOptions(this.env, r.expiresAt));
    if (r.device)
      res.cookie(
        PLATFORM_DEVICE_COOKIE,
        r.device.token,
        platformCookieOptions(this.env, r.device.expiresAt),
      );
    return { admin: r.admin, expiresAt: r.expiresAt };
  }

  /** Este navegador já é confiável? (a tela de login esconde o campo do código). */
  @Get('device')
  async device(@Req() req: Request) {
    const d = await this.auth.deviceOwner(this.deviceCookie(req));
    return d ? { trusted: true, email: d.email } : { trusted: false };
  }

  private deviceCookie(req: Request) {
    return (req.cookies as Record<string, string> | undefined)?.[PLATFORM_DEVICE_COOKIE];
  }

  @Get('me')
  @UseGuards(PlatformSessionGuard)
  me(@Req() req: Request) {
    const a = req.platformAdmin!;
    return { admin: { id: a.id, name: a.name, email: a.email } };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(PlatformSessionGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.platformAdmin!, req.ip);
    res.clearCookie(PLATFORM_COOKIE, { path: PLATFORM_COOKIE_PATH });
  }
}

/** CEP no painel Super Admin (cadastro de restaurante, contratos): mesma consulta do sistema. */
@Controller({ path: 'platform/cep', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class PlatformCepController {
  constructor(private readonly cep: CepService) {}

  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get(':cep')
  async lookup(@Param('cep') raw: string) {
    if (!/^[0-9]{5}-?[0-9]{3}$/.test(raw))
      throw new UnprocessableEntityException('CEP com 8 dígitos');
    const a = await this.cep.lookup(raw);
    if (!a) throw new NotFoundException('CEP não encontrado');
    return a;
  }

  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get()
  search(@Query('street') street = '', @Query('city') city = '', @Query('state') state = '') {
    return this.cep.search(String(state).slice(0, 2), String(city), String(street));
  }
}

@Controller({ path: 'platform', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class PlatformController {
  constructor(
    private readonly svc: PlatformService,
    private readonly backup: PlatformBackupService,
    private readonly databases: PlatformDatabasesService,
    private readonly dbServers: PlatformDbServersService,
    private readonly billing: BillingService,
    private readonly sites: PlatformSitesService,
    private readonly kitchen: PlatformKitchenService,
    private readonly migrations: PlatformMigrationsService,
    private readonly receiver: PlatformReceiveService,
    private readonly versions: PlatformVersionsService,
  ) {}

  // ---------------------------------------------------------- versão por restaurante
  /** Versão do restaurante, a principal e a atualização agendada. */
  @Get('tenants/:id/version')
  tenantVersion(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.versions.info(id);
  }

  /** Atualiza o restaurante agora para a versão principal. */
  @Post('tenants/:id/version/upgrade')
  @HttpCode(200)
  upgradeTenant(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.versions.upgrade(id, actor(req));
  }

  /** Agenda a atualização (at = null cancela). */
  @Post('tenants/:id/version/schedule')
  @HttpCode(200)
  scheduleTenant(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(TenantUpdateSchedule)) b: z.infer<typeof TenantUpdateSchedule>,
    @Req() req: Request,
  ) {
    return this.versions.schedule(id, b.at, actor(req));
  }

  // ---------------------------------------------------------- migrar cliente (origem)
  /** Stacks de destino, restaurantes que podem sair e as migrações recentes. */
  @Get('migrations')
  migrationList() {
    return this.migrations.list();
  }

  @Get('migrations/:id')
  migration(@Param('id') id: string) {
    return this.migrations.get(id);
  }

  @Post('migrations')
  createMigration(
    @Body(new ZodPipe(NewMigration)) b: z.infer<typeof NewMigration>,
    @Req() req: Request,
  ) {
    return this.migrations.create(b, actor(req));
  }

  @Post('migrations/:id/cancel')
  @HttpCode(200)
  cancelMigration(@Param('id') id: string, @Req() req: Request) {
    return this.migrations.cancel(id, actor(req));
  }

  @Post('stacks')
  createStack(@Body(new ZodPipe(StackBody)) b: z.infer<typeof StackBody>, @Req() req: Request) {
    return this.migrations.createStack(b, actor(req));
  }

  @Put('stacks/:id')
  updateStack(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(StackBody)) b: z.infer<typeof StackBody>,
    @Req() req: Request,
  ) {
    return this.migrations.updateStack(id, b, actor(req));
  }

  @Post('stacks/:id/test')
  @HttpCode(200)
  testStack(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.migrations.test(id);
  }

  @Post('stacks/:id/remove')
  @HttpCode(200)
  removeStack(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.migrations.removeStack(id, actor(req));
  }

  // ---------------------------------------------------------- migrar cliente (destino)
  /** Recebimento de restaurantes vindos de outra instalação: ligado, token e o que chegou. */
  @Get('receiver')
  receiverSettings() {
    return this.receiver.settings();
  }

  @Put('receiver')
  configureReceiver(
    @Body(new ZodPipe(ReceiverBody)) b: z.infer<typeof ReceiverBody>,
    @Req() req: Request,
  ) {
    return this.receiver.configure(b.enabled, actor(req));
  }

  /** Cozinhas do restaurante e o que as telas da cozinha mostram (aba "Cozinha"). */
  @Get('tenants/:id/kitchen')
  kitchenSettings(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.kitchen.get(id);
  }

  @Put('tenants/:id/kitchen/display')
  kitchenDisplay(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(KitchenDisplayBody)) b: z.infer<typeof KitchenDisplayBody>,
    @Req() req: Request,
  ) {
    return this.kitchen.saveDisplay(id, b, actor(req));
  }

  @Post('tenants/:id/kitchen/sectors')
  kitchenCreate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(KitchenSectorBody)) b: z.infer<typeof KitchenSectorBody>,
    @Req() req: Request,
  ) {
    return this.kitchen.createSector(id, b, actor(req));
  }

  @Put('tenants/:id/kitchen/sectors/:sectorId')
  kitchenUpdate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('sectorId', new ParseUUIDPipe()) sectorId: string,
    @Body(new ZodPipe(KitchenSectorBody)) b: z.infer<typeof KitchenSectorBody>,
    @Req() req: Request,
  ) {
    return this.kitchen.updateSector(id, sectorId, b, actor(req));
  }

  /** Status em tempo real de cada restaurante (site, domínios, banco, WhatsApp, backup). */
  @Get('sites')
  siteStatus(@Query('fresh') fresh?: string) {
    return this.sites.report(fresh === '1');
  }

  @Get('overview')
  overview() {
    return this.svc.overview();
  }

  /** Nota fiscal em todos os restaurantes: emissão, ambiente, certificado e falhas. */
  @Get('fiscal')
  fiscal() {
    return this.svc.fiscalOverview();
  }

  @Get('tenants')
  tenants(@Query('search') search?: string, @Query('status') status?: string) {
    return this.svc.listTenants({
      search: search?.trim().slice(0, 80) || undefined,
      status: status && /^[a-z]{3,20}$/.test(status) ? status : undefined,
    });
  }

  @Post('tenants')
  createTenant(@Body(new ZodPipe(NewTenant)) b: z.infer<typeof NewTenant>, @Req() req: Request) {
    return this.svc.createTenant(b, actor(req));
  }

  @Get('tenants/:id')
  tenant(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.tenant(id);
  }

  @Post('tenants/:id/database/retry')
  @HttpCode(200)
  async retryDatabase(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    await this.databases.retry(id, actor(req));
    return this.svc.tenant(id);
  }

  @Post('tenants/:id/database/move')
  @HttpCode(200)
  async moveDatabase(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    await this.databases.move(id, actor(req));
    return this.svc.tenant(id);
  }

  /** Exclui o restaurante e a base (backup final só se pedido). O resultado aparece em database-jobs. */
  @Post('tenants/:id/delete')
  @HttpCode(202)
  async deleteTenant(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(DeleteTenant)) b: z.infer<typeof DeleteTenant>,
    @Req() req: Request,
  ) {
    await this.databases.remove(id, b, actor(req));
    return this.svc.tenant(id);
  }

  /** Leva o banco do restaurante para outro servidor Postgres (ou para o principal). */
  @Post('tenants/:id/database/transfer')
  @HttpCode(200)
  async transferDatabase(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(TransferDatabase)) b: z.infer<typeof TransferDatabase>,
    @Req() req: Request,
  ) {
    await this.dbServers.transfer(id, b.to, actor(req));
    return this.svc.tenant(id);
  }

  /** Servidores de banco: o principal e os cadastrados, com os restaurantes de cada um. */
  @Get('db-servers')
  dbServerList() {
    return this.dbServers.list();
  }

  @Post('db-servers')
  createDbServer(
    @Body(new ZodPipe(DbServerBody)) b: z.infer<typeof DbServerBody>,
    @Req() req: Request,
  ) {
    return this.dbServers.create(b, actor(req));
  }

  @Put('db-servers/:id')
  updateDbServer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(DbServerUpdate)) b: z.infer<typeof DbServerUpdate>,
    @Req() req: Request,
  ) {
    return this.dbServers.update(id, b, actor(req));
  }

  @Post('db-servers/:id/test')
  @HttpCode(200)
  testDbServer(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.dbServers.test(id, actor(req));
  }

  @Post('db-servers/:id/remove')
  @HttpCode(200)
  removeDbServer(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.dbServers.remove(id, actor(req));
  }

  /** Todos os restaurantes de um servidor para outro (um por vez, na fila do serviço de backup). */
  @Post('db-servers/transfer-all')
  @HttpCode(200)
  transferAll(@Body(new ZodPipe(TransferAll)) b: z.infer<typeof TransferAll>, @Req() req: Request) {
    return this.dbServers.transferAll(b.from, b.to, actor(req));
  }

  @Get('database-jobs')
  databaseJobs(@Query('limit') limit?: string) {
    return this.databases.jobs(Number(limit) || 50);
  }

  @Post('tenants/:id/status')
  @HttpCode(200)
  setStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(StatusChange)) b: z.infer<typeof StatusChange>,
    @Req() req: Request,
  ) {
    return this.svc.setStatus(id, b, actor(req));
  }

  @Put('tenants/:id/subscription')
  async setSubscription(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(SubscriptionChange)) b: z.infer<typeof SubscriptionChange>,
    @Req() req: Request,
  ) {
    const a = actor(req);
    const r = await this.svc.setSubscription(id, b, a);
    // Período pago estendido à mão: mensalidade em aberto que ele já cobre deixa de ser cobrada.
    if (b.status !== 'cancelled' && b.currentPeriodEnd) await this.billing.cancelCovered(id, a);
    // Período pago ou situação mudou: o bloqueio automático é conferido na hora.
    await this.billing.refresh(id);
    return r;
  }

  @Get('consumption')
  consumption() {
    return this.svc.consumption();
  }

  @Get('tenants/:id/insights')
  insights(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.insights(id);
  }

  @Get('tenants/:id/team')
  team(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.team(id);
  }

  /** Link de uso único para abrir o sistema do restaurante já logado (acesso de suporte). */
  @Post('tenants/:id/access')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  access(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(SupportAccess)) b: z.infer<typeof SupportAccess>,
    @Req() req: Request,
  ) {
    return this.svc.supportAccess(id, b.userId, actor(req));
  }

  @Post('tenants/:id/sessions/revoke')
  @HttpCode(200)
  revokeSessions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(RevokeSessions)) b: z.infer<typeof RevokeSessions>,
    @Req() req: Request,
  ) {
    return this.svc.revokeSessions(id, b.userId, actor(req));
  }

  @Post('tenants/:id/password')
  @HttpCode(200)
  resetPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ResetPassword)) b: z.infer<typeof ResetPassword>,
    @Req() req: Request,
  ) {
    return this.svc.resetPassword(id, b.userId, b.password, actor(req));
  }

  @Put('tenants/:id/profile')
  profile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(TenantProfileBody)) b: z.infer<typeof TenantProfileBody>,
    @Req() req: Request,
  ) {
    return this.svc.updateProfile(id, b, actor(req));
  }

  @Put('tenants/:id/name')
  rename(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(RenameTenant)) b: z.infer<typeof RenameTenant>,
    @Req() req: Request,
  ) {
    return this.svc.renameTenant(id, b.name, actor(req));
  }

  @Post('tenants/:id/domains/:domainId/remove')
  @HttpCode(200)
  removeDomain(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('domainId', new ParseUUIDPipe()) domainId: string,
    @Req() req: Request,
  ) {
    return this.svc.removeDomain(id, domainId, actor(req));
  }

  @Get('plans')
  plans() {
    return this.svc.listPlans();
  }

  @Post('plans')
  createPlan(@Body(new ZodPipe(NewPlan)) b: z.infer<typeof NewPlan>, @Req() req: Request) {
    return this.svc.createPlan(b, actor(req));
  }

  @Put('plans/:id')
  updatePlan(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(PlanBody)) b: z.infer<typeof PlanBody>,
    @Req() req: Request,
  ) {
    return this.svc.updatePlan(id, b, actor(req));
  }

  @Get('audit')
  audit(@Query('tenantId') tenantId?: string, @Query('limit') limit?: string) {
    const uuid = /^[0-9a-f-]{36}$/i;
    return this.svc.audit({
      tenantId: tenantId && uuid.test(tenantId) ? tenantId : undefined,
      limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
    });
  }

  @Get('backups')
  backups() {
    return this.svc.backups();
  }

  @Get('backups/folders')
  backupFolders() {
    return this.svc.backupFolders();
  }

  @Get('backups/settings')
  backupSettings() {
    return this.backup.settings();
  }

  @Put('backups/settings')
  saveBackupSettings(
    @Body(new ZodPipe(BackupSettingsBody)) b: z.infer<typeof BackupSettingsBody>,
    @Req() req: Request,
  ) {
    return this.backup.save(b, actor(req));
  }

  /** Testa o bucket com os dados do formulário (a chave salva vale se o campo vier vazio). */
  @Post('backups/test')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  testBackup(@Body(new ZodPipe(BackupSettingsBody)) b: z.infer<typeof BackupSettingsBody>) {
    return this.backup.test(b);
  }

  /** Pede ao serviço de backup um backup ou teste de restauração agora. */
  @Post('backups/run')
  @HttpCode(202)
  runBackup(
    @Body(new ZodPipe(BackupRunRequest)) b: z.infer<typeof BackupRunRequest>,
    @Req() req: Request,
  ) {
    return this.backup.request(b.kind, actor(req));
  }
}

/**
 * Servidor (VM): situação, limpeza, reinício de serviço e logs, pelo agente do servidor.
 * Ações que mudam algo ficam na auditoria da plataforma.
 */
@Controller({ path: 'platform/server', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class PlatformServerController {
  constructor(
    private readonly agent: ServerAgentClient,
    private readonly db: PlatformDb,
    private readonly releases: ReleaseFeed,
    private readonly versions: PlatformVersionsService,
  ) {}

  private audit(req: Request, action: string, data: Record<string, unknown>) {
    return this.db.tx((c) =>
      platformAudit(c, {
        adminId: req.platformAdmin!.id,
        action: `platform.server.${action}`,
        entity: 'server',
        data,
        ip: req.ip,
      }),
    );
  }

  @Get()
  async status() {
    if (!this.agent.enabled) return { enabled: false };
    return { enabled: true, ...(await this.agent.call<object>('GET', '/v1/status')) };
  }

  @Get('disk')
  disk() {
    return this.agent.call('GET', '/v1/disk', undefined, 130_000);
  }

  @Post('cleanup')
  @HttpCode(200)
  async cleanup(
    @Body(new ZodPipe(ServerCleanup)) b: z.infer<typeof ServerCleanup>,
    @Req() req: Request,
  ) {
    const r = await this.agent.call<{ results: { target: string; reclaimed: number }[] }>(
      'POST',
      '/v1/cleanup',
      b,
      320_000,
    );
    await this.audit(req, 'cleanup', {
      targets: b.targets,
      reclaimed: r.results.reduce((s, x) => s + x.reclaimed, 0),
    });
    return r;
  }

  /** Restaurantes por versão e as versões antigas no ar. */
  @Get('versions')
  versionsOverview() {
    return this.versions.overview();
  }

  /** Última versão publicada e andamento da atualização em curso (se houver). */
  @Get('update')
  async updateInfo() {
    const [feed, job] = await Promise.all([
      this.releases.latest(),
      this.agent.enabled
        ? this.agent.call<{ job: unknown }>('GET', '/v1/update').catch(() => ({ job: null }))
        : Promise.resolve({ job: null }),
    ]);
    return { ...feed, job: job.job };
  }

  /** Troca a tag das imagens do Comandou nos serviços (migração primeiro). Ver agente/updater.ts. */
  @Post('update')
  @HttpCode(202)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async update(
    @Body(new ZodPipe(SystemUpdate)) b: z.infer<typeof SystemUpdate>,
    @Req() req: Request,
  ) {
    // Quem não foi atualizado fica na versão atual: a cópia dela sobe antes (versão por cliente).
    await this.versions.holdBeforeSystemUpdate(b.version, actor(req));
    const r = await this.agent.call<{ job: { steps: { service: string; from: string }[] } }>(
      'POST',
      '/v1/update',
      b,
      60_000,
    );
    await this.audit(req, 'system_update_started', {
      version: b.version,
      services: r.job.steps.map((s) => `${s.service}:${s.from}`),
    });
    return r;
  }

  /** VM: SO, atualizações do sistema, caches e trabalhos do ajudante (scripts/vm.sh). */
  @Get('vm')
  async vm() {
    if (!this.agent.enabled) return { enabled: false };
    try {
      return { enabled: true, ...(await this.agent.call<object>('GET', '/v1/vm')) };
    } catch (e) {
      // Agente antigo (sem /v1/vm): a tela pede para rodar o instalador de novo.
      return { enabled: true, installed: false, outdated: true, error: (e as Error).message };
    }
  }

  @Post('vm/actions')
  @HttpCode(202)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async vmAction(@Body(new ZodPipe(VmAction)) b: z.infer<typeof VmAction>, @Req() req: Request) {
    const r = await this.agent.call<{ id: string }>('POST', '/v1/vm/actions', {
      action: b.action,
      targets: b.targets ?? [],
    });
    await this.audit(req, `vm_${b.action.replace(/-/g, '_')}`, {
      job: r.id,
      ...(b.targets ? { targets: b.targets } : {}),
    });
    return r;
  }

  @Get('vm/jobs/:id')
  vmJob(@Param('id', new ZodPipe(VmJobId)) id: string) {
    return this.agent.call('GET', `/v1/vm/jobs/${id}`);
  }

  /** Componentes (Postgres, Redis, Traefik, Docker...) com versões e se há compilação nova. */
  @Get('components')
  components(@Query('fresh') fresh?: string) {
    return this.agent.call(
      'GET',
      `/v1/components${fresh === '1' ? '?fresh=1' : ''}`,
      undefined,
      90_000,
    );
  }

  @Post('components/:name/update')
  @HttpCode(202)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async updateComponent(
    @Param('name', new ZodPipe(ServiceName)) name: string,
    @Req() req: Request,
  ) {
    const r = await this.agent.call<{ image: string; to: string }>(
      'POST',
      `/v1/components/${encodeURIComponent(name)}/update`,
      undefined,
      60_000,
    );
    await this.audit(req, 'component_updated', { service: name, image: r.image, digest: r.to });
    return r;
  }

  @Post('services/:name/restart')
  @HttpCode(200)
  async restart(@Param('name', new ZodPipe(ServiceName)) name: string, @Req() req: Request) {
    const r = await this.agent.call('POST', `/v1/services/${encodeURIComponent(name)}/restart`);
    await this.audit(req, 'service_restarted', { service: name });
    return r;
  }

  @Get('services/:name/logs')
  async logs(
    @Param('name', new ZodPipe(ServiceName)) name: string,
    @Query('tail') tail: string | undefined,
    @Req() req: Request,
  ) {
    const n = Math.min(Math.max(Number(tail) || 200, 10), 1000);
    const r = await this.agent.call(
      'GET',
      `/v1/services/${encodeURIComponent(name)}/logs?tail=${n}`,
    );
    await this.audit(req, 'logs_viewed', { service: name });
    return r;
  }
}

/** Aba Tokens: chaves do OpenRouter, modelo, limites, tokens extras e o uso de cada um. */
@Controller({ path: 'platform/ai', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class PlatformAiController {
  constructor(private readonly ai: PlatformAiService) {}

  @Get()
  overview(@Query('fresh') fresh?: string) {
    return this.ai.overview(fresh === '1');
  }

  @Get('models')
  models() {
    return this.ai.models();
  }

  @Put('settings')
  save(@Body(new ZodPipe(AiSettingsBody)) b: z.infer<typeof AiSettingsBody>, @Req() req: Request) {
    return this.ai.save(b, actor(req));
  }

  @Post('test')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  test(@Body(new ZodPipe(AiTestBody)) b: z.infer<typeof AiTestBody>, @Req() req: Request) {
    return this.ai.test(b, actor(req));
  }

  @Get('usage')
  usage() {
    return this.ai.usageLog(200);
  }

  @Get('tenants/:id/history')
  tenantHistory(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ai.tenantHistory(id);
  }

  @Post('tenants/:id/tokens')
  @HttpCode(200)
  grant(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(TokenGrantBody)) b: z.infer<typeof TokenGrantBody>,
    @Req() req: Request,
  ) {
    return this.ai.grant(id, b, actor(req));
  }

  @Put('tenants/:id')
  saveTenant(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(TenantAiBody)) b: z.infer<typeof TenantAiBody>,
    @Req() req: Request,
  ) {
    return this.ai.saveTenant(id, b, actor(req));
  }
}

/**
 * Rotas que a instalação de ORIGEM chama para mandar um restaurante para cá. Sem sessão do
 * painel: valem só com o token de recebimento gerado aqui (Infraestrutura → Migrações).
 */
@Controller({ path: 'platform/receive', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard)
@Throttle({ default: { ttl: 60_000, limit: 600 } })
export class PlatformReceiveController {
  constructor(private readonly svc: PlatformReceiveService) {}

  private auth(req: Request) {
    return this.svc.authorize(req.get('authorization'));
  }

  @Get('hello')
  async hello(@Req() req: Request) {
    await this.auth(req);
    return this.svc.hello();
  }

  @Get('check')
  async check(@Req() req: Request, @Query('slug') slug = '', @Query('tenantId') tenantId = '') {
    await this.auth(req);
    return this.svc.slugCheck(String(slug), String(tenantId));
  }

  @Post()
  async open(@Req() req: Request, @Body() body: Manifest) {
    await this.auth(req);
    if (!body || typeof body !== 'object' || typeof body.tenantId !== 'string')
      throw new UnprocessableEntityException('Manifesto inválido');
    return this.svc.open(body);
  }

  @Put(':id/chunks/:idx')
  async chunk(@Req() req: Request, @Param('id') id: string, @Param('idx') idx: string) {
    await this.auth(req);
    const data = req.body as unknown;
    if (!Buffer.isBuffer(data) || data.length > CHUNK_LIMIT)
      throw new UnprocessableEntityException('Envie o bloco como application/octet-stream');
    return this.svc.putChunk(id, Number(idx), data);
  }

  @Get(':id')
  async view(@Req() req: Request, @Param('id') id: string) {
    await this.auth(req);
    return this.svc.view(id);
  }

  @Post(':id/install')
  @HttpCode(200)
  async install(@Req() req: Request, @Param('id') id: string) {
    await this.auth(req);
    return this.svc.install(id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  async activate(@Req() req: Request, @Param('id') id: string) {
    await this.auth(req);
    return this.svc.activate(id);
  }

  @Post(':id/discard')
  @HttpCode(200)
  async discard(@Req() req: Request, @Param('id') id: string) {
    await this.auth(req);
    return this.svc.discard(id);
  }
}
