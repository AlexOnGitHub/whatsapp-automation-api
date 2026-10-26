import { Module } from '@nestjs/common';

import { BusinessesModule } from '../businesses/businesses.module';

import { ServicesCatalogController } from './services-catalog.controller';
import { ServicesCatalogService } from './services-catalog.service';

@Module({
  imports: [BusinessesModule],

  controllers: [ServicesCatalogController],

  providers: [ServicesCatalogService],

  exports: [ServicesCatalogService],
})
export class ServicesCatalogModule {}
