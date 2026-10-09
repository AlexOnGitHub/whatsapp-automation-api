import { Module } from '@nestjs/common';

import { BusinessesModule } from '../businesses/businesses.module';

import { BusinessConfigsController } from './business-configs.controller';
import { BusinessConfigsService } from './business-configs.service';

@Module({
  imports: [BusinessesModule],
  controllers: [BusinessConfigsController],
  providers: [BusinessConfigsService],
  exports: [BusinessConfigsService],
})
export class BusinessConfigsModule {}
