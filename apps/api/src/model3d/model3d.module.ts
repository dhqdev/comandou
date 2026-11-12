import { Module } from '@nestjs/common';
import { Model3dService } from './model3d.service';

@Module({ providers: [Model3dService], exports: [Model3dService] })
export class Model3dModule {}
