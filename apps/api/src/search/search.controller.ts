import { Controller, Get, Query } from '@nestjs/common';
import type { SearchHit } from '@comandou/shared';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser } from '../common/decorators';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { parseTerm, runSearch } from './search';

export { foldText, parseTerm } from './search';
export type { SearchHit, SearchKind } from '@comandou/shared';

/**
 * Busca global do sistema do restaurante (barra do topo e Ctrl+K). Procura em tudo que o papel
 * do usuário pode ver; telas e atalhos são resolvidos no próprio app.
 */
@Controller({ version: '1' })
export class SearchController {
  constructor(private readonly db: DatabaseService) {}

  @Get('search')
  async search(
    @Query('q') raw: string | undefined,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ results: SearchHit[] }> {
    const term = parseTerm(typeof raw === 'string' ? raw : '');
    if (!term) return { results: [] };
    const results = await this.db.withTenant(ctxOf(tenant, user), (tx) =>
      runSearch(tx, user.role, term),
    );
    return { results };
  }
}
