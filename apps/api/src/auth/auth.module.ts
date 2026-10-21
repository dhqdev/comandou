import { Module } from '@nestjs/common';
import { AuthController, TenantInfoController } from './auth.controller';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController, TenantInfoController],
  providers: [SessionService],
  exports: [SessionService],
})
export class AuthModule {}
