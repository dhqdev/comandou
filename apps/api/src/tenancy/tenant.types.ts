import type { Role, TenantStatus } from '@comandou/shared';

export interface ResolvedTenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  sessionId: string;
}

declare module 'express' {
  interface Request {
    tenant?: ResolvedTenant;
    user?: AuthenticatedUser;
  }
}
