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
