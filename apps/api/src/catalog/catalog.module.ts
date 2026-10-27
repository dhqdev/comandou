import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { FamiliesController } from './families.controller';
import { MenusController } from './menus.controller';
import { OptionsController } from './options.controller';

@Module({
  controllers: [CatalogController, OptionsController, MenusController, FamiliesController],
})
export class CatalogModule {}
