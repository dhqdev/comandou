import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { FamiliesController } from './families.controller';
import { MenusController } from './menus.controller';
import { ProductModelsController } from './models.controller';
import { OptionsController } from './options.controller';
import { ProductExtrasController } from './product-extras.controller';

@Module({
  controllers: [
    CatalogController,
    OptionsController,
    MenusController,
    FamiliesController,
    ProductModelsController,
    ProductExtrasController,
  ],
})
export class CatalogModule {}
