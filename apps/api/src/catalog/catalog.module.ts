import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { OptionsController } from './options.controller';

@Module({ controllers: [CatalogController, OptionsController] })
export class CatalogModule {}
