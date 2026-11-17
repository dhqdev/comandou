import { Module } from '@nestjs/common';
import { AuthController, TenantInfoController } from './auth.controller';
import { StaffPasswordResetService } from './password-reset.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController, TenantInfoController],
  providers: [SessionService, StaffPasswordResetService],
  exports: [SessionService],
})
export class AuthModule {}
