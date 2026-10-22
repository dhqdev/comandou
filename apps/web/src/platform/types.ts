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
}

export interface Overview {
  version: string;
  health: { database: HealthState; redis: HealthState; whatsappGateway: HealthState };
  queue: Record<string, number> | null;
  tenants: Record<string, number>;
  subscriptions: Record<string, number>;
  backups: Record<'backup' | 'restoreTest', { last: BackupRun | null; lastOkAt: string | null }>;
  last7Days: { fiscalErrors: number; messageFailures: number };
}

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: string;
  subscriptionStatus: string | null;
  planName: string | null;
  users: number;
  products: number;
  ordersMonth: number;
  lastOrderAt: string | null;
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
  subscribers: number;
}

export interface TenantDetail {
  id: string;
  slug: string;
  name: string;
  status: string;
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
  audit: AuditRow[];
}

export interface AuditRow {
  id: string;
  action: string;
  entity?: string;
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
