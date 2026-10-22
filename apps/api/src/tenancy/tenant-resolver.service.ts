import { Inject, Injectable } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { classifyHost } from './host';
import { ResolvedTenant } from './tenant.types';

export type ResolveOutcome =
  | { ok: true; tenant: ResolvedTenant }
  | { ok: false; reason: 'invalid-host' | 'platform-host' | 'not-found' };

@Injectable()
export class TenantResolverService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async resolve(rawHost: string | undefined): Promise<ResolveOutcome> {
    const c = classifyHost(rawHost, this.env.PEDEMAIS_BASE_DOMAIN);
    if (c.kind === 'invalid') return { ok: false, reason: 'invalid-host' };
    if (c.kind === 'platform') return { ok: false, reason: 'platform-host' };
    const slug = c.kind === 'tenant-subdomain' ? c.slug : null;
    const rows = await this.db.queryUnscoped<ResolvedTenant>(
      'SELECT id, slug, name, status FROM app_resolve_tenant($1, $2)',
      [slug, c.hostname],
    );
    const tenant = rows[0];
    if (!tenant) return { ok: false, reason: 'not-found' };
    return { ok: true, tenant };
  }
}
