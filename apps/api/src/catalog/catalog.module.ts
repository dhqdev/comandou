import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { FamiliesController } from './families.controller';
import { ItemAiController } from './item-ai.controller';
import { ItemAiService } from './item-ai.service';
import { MenusController } from './menus.controller';
import { OptionsController } from './options.controller';
import { ProductExtrasController } from './product-extras.controller';

@Module({
  controllers: [
    CatalogController,
    OptionsController,
    MenusController,
    FamiliesController,
    ProductExtrasController,
    ItemAiController,
  ],
  providers: [ItemAiService],
})
export class CatalogModule {}
