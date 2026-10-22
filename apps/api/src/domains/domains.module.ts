import { Module } from '@nestjs/common';
import { DomainsController, DomainVerifier } from './domains.controller';
import { InternalController } from './internal.controller';

@Module({
  controllers: [DomainsController, InternalController],
  providers: [DomainVerifier],
})
export class DomainsModule {}
