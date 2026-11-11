import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { FamiliesController } from './families.controller';
import { MenusController } from './menus.controller';
import { ProductModelsController } from './models.controller';
import { OptionsController } from './options.controller';

@Module({
  controllers: [
    CatalogController,
    OptionsController,
    MenusController,
    FamiliesController,
    ProductModelsController,
  ],
})
export class CatalogModule {}
