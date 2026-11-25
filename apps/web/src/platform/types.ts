export type HealthState = 'ok' | 'error' | 'disabled';

export interface BackupRun {
  id: string;
  kind: 'backup' | 'restore_test';
  status: 'running' | 'ok' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  objectKey?: string | null;
  sizeBytes: string | null;
  sha256?: string | null;
  details?: Record<string, unknown>;
  error: string | null;
  database?: string | null;
  tenantId?: string | null;
  tenantSlug?: string | null;
  tenantName?: string | null;
}

export interface Overview {
  version: string;
  health: { database: HealthState; redis: HealthState; whatsappGateway: HealthState };
  queue: Record<string, number> | null;
  tenants: Record<string, number>;
  subscriptions: Record<string, number>;
  backups: Record<'backup' | 'restoreTest', { last: BackupRun | null; lastOkAt: string | null }>;
  last7Days: { fiscalErrors: number; messageFailures: number };
  databases?: Partial<Record<TenantDatabaseStatus, number>>;
}

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  /** Ícone que o restaurante pôs na Loja online (favicon, senão logo). */
  iconUrl: string | null;
  createdAt: string;
  subscriptionStatus: string | null;
  planName: string | null;
  users: number;
  products: number;
  ordersMonth: number;
  lastOrderAt: string | null;
  /** Banco próprio (null = banco central). */
  dbName: string | null;
  dbStatus: TenantDatabaseStatus | null;
  city?: string | null;
  state?: string | null;
}

/** Cadastro do cliente (contato e cobrança), só no painel. */
export interface TenantProfile {
  legalName: string | null;
  document: string | null;
  contactName: string | null;
  phone: string | null;
  billingEmail: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  updatedAt: string | null;
}

export type TenantDatabaseStatus =
  'creating' | 'ready' | 'failed' | 'moving' | 'deleting' | 'transferring' | 'receiving';

/** Trabalho de banco (criar, mover para banco próprio, excluir) feito pelo serviço de backup. */
export interface DbJob {
  id: string;
  kind: 'create' | 'move' | 'delete' | 'transfer' | 'migrate' | 'receive' | 'upgrade';
  status: 'queued' | 'running' | 'done' | 'failed';
  step: string | null;
  error: string | null;
  reason: string | null;
  result: {
    database?: string;
    finalBackupKey?: string;
    finalBackupSize?: number;
    rows?: number;
    warning?: string;
    from?: string;
    to?: string;
    backupKey?: string;
  };
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface LastBackup {
  status: 'running' | 'ok' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  objectKey: string | null;
  sizeBytes: string | null;
  error: string | null;
}

export interface TenantDatabase {
  kind: 'dedicated' | 'shared';
  name: string | null;
  status: TenantDatabaseStatus;
  lastError: string | null;
  readyAt: string | null;
  /** Servidor extra onde fica o banco (null = servidor principal). */
  server: { id: string; name: string; host: string } | null;
  sizeBytes: number | null;
  backupFolder: string | null;
  lastBackup: LastBackup | null;
  jobs: DbJob[];
  worker: {
    alive: boolean;
    lastSeenAt: string | null;
    canCreateDatabases: boolean | null;
    version: string | null;
  };
}

export interface BackupFolders {
  prefix: string;
  platform: { folder: string; lastBackup: LastBackup | null };
  tenants: {
    id: string;
    slug: string;
    name: string;
    status: string;
    database: string | null;
    databaseStatus: TenantDatabaseStatus | null;
    folder: string | null;
    lastBackup: LastBackup | null;
  }[];
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  priceMonthly: string;
  maxUsers: number | null;
  maxProducts: number | null;
  maxOrdersMonth: number | null;
  featureFiscal: boolean;
  featureWhatsapp: boolean;
  featureCustomDomain: boolean;
  trialDays: number;
  isDefault: boolean;
  active: boolean;
  tagline: string;
  highlights: string[];
  featured: boolean;
  showPublic: boolean;
  sortOrder: number;
  subscribers: number;
  /** Restaurantes de plano antigo que passam para este na próxima mensalidade. */
  scheduledIn?: number;
}

export interface TenantDetail {
  id: string;
  slug: string;
  name: string;
  status: string;
  iconUrl: string | null;
  timezone: string;
  createdAt: string;
  subscription: {
    id: string;
    status: 'trialing' | 'active' | 'past_due' | 'cancelled';
    planId: string;
    startedAt: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    notes: string | null;
  } | null;
  profile: TenantProfile;
  usage: {
    users: number;
    products: number;
    ordersMonth: number;
    lastOrderAt: string | null;
    fiscalErrors: number;
    messageFailures: number;
  };
  domains: { id: string; hostname: string; verifiedAt: string | null; lastError: string | null }[];
  owners: { name: string; email: string }[];
  provisioning: { step: string; status: string; attempts: number; lastError: string | null }[];
  database: TenantDatabase;
}

export interface AuditRow {
  id: string;
  action: string;
  entity?: string;
  tenantId?: string | null;
  tenantSlug?: string | null;
  data: Record<string, unknown>;
  ip?: string | null;
  createdAt: string;
  adminName: string | null;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'revoked';
  disabledAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  activeSessions: number;
  otherTenants: number;
}

export interface SupportLink {
  slug: string;
  token: string;
  expiresAt: string;
  user: { id: string; name: string; email: string };
}

export interface ServerSample {
  at: number;
  cpu: number;
  mem: number;
  rxBps: number;
  txBps: number;
}
export interface ServerService {
  id: string;
  name: string;
  stack: string | null;
  image: string;
  mode: 'replicated' | 'global';
  desired: number | null;
  running: number;
  updatedAt: string;
  updateState: string | null;
  lastError: string | null;
  /** Estado da tarefa mais nova ("complete" = execução única que terminou bem). */
  taskState?: string | null;
}
export interface ServerContainer {
  id: string;
  name: string;
  service: string | null;
  image: string;
  state: string;
  status: string;
  createdAt: string;
  memoryBytes: number | null;
}
export type ServerStatus =
  | { enabled: false }
  | {
      enabled: true;
      at: string;
      host: {
        hostname: string;
        uptimeSec: number;
        cores: number;
        load: [number, number, number];
        cpu: { percent: number | null; steal: number };
        memory: {
          total: number;
          available: number;
          used: number;
          swapTotal: number;
          swapUsed: number;
        };
        disks: { mount: string; total: number; free: number }[];
        network: { rxBps: number | null; txBps: number | null };
      };
      history: ServerSample[];
      docker:
        | { error: string }
        | {
            version: string;
            swarm: boolean;
            /** Stack do Comandou: a tela mostra só os serviços dela. */
            stack?: string | null;
            manager: boolean;
            containers: { total: number; running: number; list: ServerContainer[] };
            services: ServerService[];
          };
    };
export interface DockerDisk {
  images: { count: number; size: number; unused: number; reclaimable: number };
  containers: { count: number; stopped: number; reclaimable: number };
  volumes: { count: number; size: number };
  buildCache: { count: number; reclaimable: number };
}

export interface KeyCount {
  key: string;
  count: number;
}
export interface TenantInsights {
  footprint: {
    tables: { table: string; rows: number; bytes: number }[];
    rows: number;
    bytes: number;
    databaseBytes: number;
    /** Banco próprio do restaurante (null = banco central). */
    database?: string | null;
    share: number;
  };
  traffic: { requests: number; seconds: number; errors: number; timeShare: number } | null;
  onlineNow: number;
  operation: {
    orders: {
      total: number;
      cancelled: number;
      revenue: number;
      avgTicket: number;
      open: number;
      first: string | null;
      last: string | null;
      allTime: number;
    };
    byChannel: (KeyCount & { revenue: number })[];
    byStatus: KeyCount[];
    byDay: { day: string; count: number; revenue: number }[];
    byHour: { hour: number; count: number }[];
    payments: (KeyCount & { amount: number })[];
    topProducts: { name: string; qty: number }[];
    catalog: {
      categories: number;
      products: number;
      soldOut: number;
      tables: number;
      sectors: number;
    };
    cash: { openSessions: number; sessions30d: number; difference30d: number; openTabs: number };
    delivery: { couriers: number; byStatus: KeyCount[] };
    stock: { items: number; belowMin: number };
    fiscal: KeyCount[];
    messages: KeyCount[];
    printAgents: {
      name: string;
      active: boolean;
      lastSeenAt: string | null;
      version: string | null;
    }[];
    printJobs: KeyCount[];
    users: { id: string; orders30d: number; payments30d: number }[];
  };
}
export interface ConsumptionRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  rows: number;
  bytes: number;
  requests: number | null;
  seconds: number | null;
  errors: number | null;
  timeShare: number | null;
}
export interface Consumption {
  databaseBytes: number;
  trafficEnabled: boolean;
  tenants: ConsumptionRow[];
}

export interface UpdateStep {
  service: string;
  from: string;
  to: string;
  status: 'pending' | 'running' | 'ok' | 'skipped' | 'failed';
  message?: string;
  /** Quando este serviço começou a trocar (agente 0.230+). */
  startedAt?: string;
}
export interface UpdateJob {
  id: string;
  version: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'done' | 'failed';
  message?: string;
  steps: UpdateStep[];
  cleanup?: { target: string; reclaimed: number; removed: number; error?: string }[];
  /** Última vez que o agente conferiu o andamento. */
  checkedAt?: string;
}
export interface UpdateInfo {
  latest: { version: string; url: string; publishedAt: string | null } | null;
  error?: string;
  job: UpdateJob | null;
  /** Hora do servidor (mede "parado há X min" sem depender do relógio do aparelho). */
  now?: string;
  /** O agente não respondeu a esta consulta. */
  agentDown?: boolean;
}

export interface BackupSettings {
  enabled: boolean;
  configured: boolean;
  /** Para onde vai o backup agora: bucket, pasta do servidor ou nenhum. */
  destination?: 'b2' | 'local' | null;
  local?: {
    dir: string;
    files: number;
    bytes: number;
    freeBytes?: number;
    totalBytes?: number;
  } | null;
  endpoint: string;
  region: string;
  resolvedRegion: string | null;
  bucket: string;
  prefix: string;
  keyId: string;
  hasApplicationKey: boolean;
  runAt: string;
  retentionDays: number;
  restoreTestWeekday: number;
  backupRequestedAt: string | null;
  restoreRequestedAt: string | null;
  worker: { alive: boolean; lastSeenAt: string | null };
  keyConfigured: boolean;
  updatedAt: string | null;
}

export interface BackupTestResult {
  ok: boolean;
  canDelete: boolean;
  steps: { step: string; ok: boolean; detail?: string }[];
}

// ------------------------------------------------------------------ contratos
export type ContractStatus = 'draft' | 'sent' | 'viewed' | 'client_signed' | 'signed' | 'cancelled';

export interface ContractGeo {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface ContractParty {
  role: 'CONTRATADA' | 'CONTRATANTE';
  name: string;
  document: string | null;
  address: string | null;
  email: string | null;
  representative: string | null;
}

/** Texto congelado do contrato (o mesmo do PDF). Item em lista = alíneas do parágrafo anterior. */
export interface ContractContent {
  version: 1 | 2;
  number: string;
  title: string;
  issuedAt: string;
  parties: { provider: ContractParty; customer: ContractParty };
  terms: {
    storeName: string;
    systemAddress: string;
    planName: string;
    priceMonthly: string;
    setupFee: string;
    dueDay: number;
    termMonths: number;
    startDate: string;
    trialDays: number;
    slaPercent: string;
  };
  preamble: string;
  clauses: { title: string; items: (string | string[])[] }[];
  closing: string;
}

export interface ContractRow {
  /** Fim da vigência (AAAA-MM-DD); o contrato é reassinado todo ano. */
  validUntil?: string | null;
  startDate?: string;
  id: string;
  tenantId: string;
  number: string;
  status: ContractStatus;
  planName: string;
  priceMonthly: string;
  signerEmail: string | null;
  contentHash: string;
  pdfSha256: string;
  signedPdfSha256: string | null;
  expiresAt: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  readAt: string | null;
  signedAt: string | null;
  signerName: string | null;
  signerDocument: string | null;
  signerIp: string | null;
  signerUserAgent: string | null;
  signerGeo: ContractGeo | null;
  signatureKind: 'drawn' | 'typed' | null;
  clientEvidenceSha256: string | null;
  countersignDeadline: string | null;
  countersignedAt: string | null;
  countersignerName: string | null;
  countersignerDocument: string | null;
  countersignerEmail: string | null;
  countersignerIp: string | null;
  countersignKind: 'drawn' | 'typed' | null;
  trailSha256: string | null;
  notifiedAt: string | null;
  notifyError: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface ContractEvent {
  kind: string;
  ip: string | null;
  userAgent: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  hash: string | null;
}

export interface ContractDetail extends ContractRow {
  content: ContractContent;
  events: ContractEvent[];
  clientSignature: { kind: 'drawn'; image: string } | { kind: 'typed'; text: string } | null;
  integrity: {
    trailOk: boolean;
    chainedEvents: number;
    lastHash: string | null;
    clientEvidenceOk: boolean | null;
  };
}

/** Assinado pelo cliente, esperando a contratada. */
export interface PendingContract {
  id: string;
  tenantId: string;
  tenantName: string;
  number: string;
  signerName: string;
  signedAt: string;
  deadline: string;
}

export interface ContractSettings {
  providerName: string;
  providerDocument: string;
  providerAddress: string;
  providerEmail: string;
  providerRepresentative: string;
  providerRepresentativeDocument: string;
  forumCity: string;
  dueDay: number;
  termMonths: number;
  slaPercent: string;
  readjustIndex: string;
  lateFeePercent: string;
  lateInterestPercent: string;
  suspendAfterDays: number;
  supportHours: string;
  /** Envio de e-mail configurado em Super Admin › E-mail. */
  mailReady: boolean;
  notifyEmail: string;
  keyConfigured: boolean;
  ready: boolean;
  updatedAt: string;
}

/** O que o link público de assinatura devolve. */
export interface PublicContract {
  number: string;
  status: ContractStatus;
  contentHash: string;
  pdfSha256: string;
  signerEmail: string | null;
  expiresAt: string | null;
  readAt: string | null;
  signedAt: string | null;
  signerName: string | null;
  countersignedAt: string | null;
  countersignDeadline: string | null;
  content: ContractContent;
}

/** Conferência de um servidor de banco pelo serviço de backup (papel dono). */
export interface DbServerCheck {
  ok: boolean;
  at: string;
  latencyMs?: number;
  version?: string;
  canCreateDatabases?: boolean;
  canTerminate?: boolean;
  appRoles?: boolean;
  databases?: number;
  bytes?: number;
  error?: string;
}

/** Conferência pela API: os papéis da aplicação e do painel entram com as mesmas senhas. */
export interface DbServerApiCheck {
  ok: boolean;
  at: string;
  app: { ok: boolean; ms: number; error?: string };
  platform: { ok: boolean; ms: number; error?: string };
}

export interface DbServerRestaurant {
  id: string;
  slug: string;
  name: string;
  status: string;
  dbStatus: TenantDatabaseStatus;
  /** Trabalho de banco na fila ou rodando (ex.: esperando a vez no "Mover todos"). */
  busy?: boolean;
}

export interface DbServer {
  id: string;
  name: string;
  host: string;
  port: number;
  ssl: 'disable' | 'require';
  acceptsNew: boolean;
  status: 'active' | 'retired';
  note: string | null;
  tenants: number;
  check: DbServerCheck | null;
  apiCheck: DbServerApiCheck | null;
  createdAt: string;
  restaurants: DbServerRestaurant[];
}

export interface DbServers {
  main: {
    id: 'main';
    name: string;
    host: string;
    port: number;
    acceptsNew: boolean;
    tenants: number;
    legacyTenants: number;
    check: DbServerCheck | null;
    restaurants: DbServerRestaurant[];
  };
  servers: DbServer[];
  worker: TenantDatabase['worker'];
}

/** Status em tempo real de cada restaurante (tela inicial do painel). */
export interface SiteCheck {
  ok: boolean;
  http: number | null;
  ms: number | null;
  error?: string;
}
export type SiteState = 'online' | 'attention' | 'offline' | 'suspended' | 'setup';
export interface SiteStatus {
  id: string;
  slug: string;
  name: string;
  status: string;
  planName: string | null;
  subscriptionStatus: string | null;
  host: string;
  state: SiteState;
  issues: string[];
  web: SiteCheck | null;
  domains: { hostname: string; verified: boolean; check: SiteCheck | null }[];
  database: {
    kind: 'dedicated' | 'shared';
    name: string | null;
    status: string | null;
    server: string | null;
    check: SiteCheck | null;
  };
  whatsapp: {
    status: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'logged_out' | 'unknown';
    phone: string | null;
  } | null;
  backup: { lastOkAt: string | null; lastStatus: string | null; lastAt: string | null };
  lastOrderAt: string | null;
  ordersMonth: number;
}
export interface SitesReport {
  checkedAt: string;
  baseDomain: string;
  whatsappGateway: HealthState;
  sites: SiteStatus[];
}

// ------------------------------------------------------------ migrar cliente (outra instalação)
export type MigrationPhaseName =
  'preparar' | 'enviar' | 'criar' | 'restaurar' | 'virar' | 'encerrar';

export interface MigrationPhase {
  name: MigrationPhaseName;
  status: 'pendente' | 'rodando' | 'ok' | 'falhou' | 'pulada' | 'desfeita';
  startedAt: string | null;
  finishedAt: string | null;
  detail: string | null;
}

export interface Migration {
  id: string;
  code: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  stackId: string | null;
  stackName: string;
  mode: 'move' | 'copy';
  options: {
    targetSlug?: string;
    backupBefore?: boolean;
    keepSuspended?: boolean;
    dropAtOrigin?: boolean;
    ignoreKeyMismatch?: boolean;
    previousStatus?: string;
  };
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  phase: MigrationPhaseName | null;
  phases: MigrationPhase[];
  package: {
    size?: number;
    sha256?: string;
    chunkSize?: number;
    chunks?: number;
    sent?: number;
    tables?: number;
    rows?: number;
    database?: string;
  };
  remoteUrl: string | null;
  result: {
    warning?: string;
    backupKey?: string;
    finalBackupKey?: string;
    url?: string;
    droppedAtOrigin?: string;
    destination?: { version: string; baseDomain: string; sameKey: boolean };
  };
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface StackCheck {
  ok: boolean;
  ms: number;
  version?: string;
  baseDomain?: string;
  missingMigrations?: number;
  firstMissing?: string | null;
  sameKey?: boolean;
  workerAlive?: boolean;
  error?: string;
  at: string;
}

export interface Stack {
  id: string;
  name: string;
  url: string;
  tokenHint: string | null;
  note: string | null;
  check: StackCheck | null;
  createdAt: string;
}

export interface Migrations {
  keyFingerprint: string | null;
  migrations: number;
  stacks: Stack[];
  tenants: { id: string; slug: string; name: string; status: string; ready: boolean }[];
  list: Migration[];
  worker: { alive: boolean; lastSeenAt: string | null };
}

export interface Reception {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  source: { code?: string; url?: string | null; version?: string; slug?: string };
  mode: 'move' | 'copy';
  status: 'receiving' | 'installing' | 'restored' | 'active' | 'failed' | 'discarded';
  step: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  size: string | null;
}

export interface Receiver {
  enabled: boolean;
  tokenHint: string | null;
  baseDomain: string;
  adminUrl: string;
  keyFingerprint: string | null;
  receptions: Reception[];
  /** Só na resposta de "ligar": o token aparece uma vez. */
  token?: string | null;
}

/** GET /platform/fiscal: a nota fiscal de cada restaurante (cartão da ficha do restaurante). */
export interface FiscalRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  featureFiscal: boolean | null;
  certificateAlert: 'expired' | 'soon' | null;
  fiscal: {
    enabled: boolean;
    nfeEnabled: boolean;
    mode: 'own' | 'managed';
    environment: 'homologacao' | 'producao';
    cnpj: string | null;
    focusRegistered: boolean;
    certificateValidUntil: string | null;
    authorized30d: number;
    failed7d: number;
    pendingNow: number;
    lastAuthorizedAt: string | null;
  } | null;
}
export interface FiscalOverview {
  totals: { enabled: number; production: number; failed7d: number; certificateAlerts: number };
  tenants: FiscalRow[];
  errors: { dbName: string; error: string }[];
}
