import { Module } from '@nestjs/common';

import { BusinessesModule } from '../businesses/businesses.module';

import { BusinessModulesController } from './business-modules.controller';
import { BusinessModulesService } from './business-modules.service';

@Module({
  imports: [BusinessesModule],
  controllers: [BusinessModulesController],
  providers: [BusinessModulesService],
  exports: [BusinessModulesService],
})
export class BusinessModulesModule {}
