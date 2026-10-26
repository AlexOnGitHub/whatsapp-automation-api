import { Module } from '@nestjs/common';

import { BusinessesModule } from '../businesses/businesses.module';

import { BusinessConfigsModule } from '../business-configs/business-configs.module';

import { ServicesCatalogModule } from '../services-catalog/services-catalog.module';

import { AppointmentAvailabilityService } from './appointment-availability.service';

@Module({
  imports: [BusinessesModule, BusinessConfigsModule, ServicesCatalogModule],

  providers: [AppointmentAvailabilityService],

  exports: [AppointmentAvailabilityService],
})
export class AppointmentAvailabilityModule {}
