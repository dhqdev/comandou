import { Module } from '@nestjs/common';
import { IfoodController } from './ifood.controller';
import { IfoodService } from './ifood.service';

@Module({
  controllers: [IfoodController],
  providers: [IfoodService],
  exports: [IfoodService],
})
export class IfoodModule {}
