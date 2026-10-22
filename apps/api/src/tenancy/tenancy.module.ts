import { Module } from '@nestjs/common';
import { TenantResolverService } from './tenant-resolver.service';

@Module({ providers: [TenantResolverService], exports: [TenantResolverService] })
export class TenancyModule {}
