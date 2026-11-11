import { Module } from '@nestjs/common';

import { BusinessesModule } from '../businesses/businesses.module';

import { ServicesCatalogModule } from '../services-catalog/services-catalog.module';

import { AppointmentAvailabilityModule } from '../appointment-availability/appointment-availability.module';

import { InteractionLogsModule } from '../interaction-logs/interaction-logs.module';

import { AppointmentBookingService } from './appointment-booking.service';

import { IntegrationJobsModule } from '../integration-jobs/integration-jobs.module';

@Module({
  imports: [
    BusinessesModule,
    ServicesCatalogModule,
    AppointmentAvailabilityModule,
    InteractionLogsModule,
    IntegrationJobsModule,
  ],

  providers: [AppointmentBookingService],

  exports: [AppointmentBookingService],
})
export class AppointmentBookingModule {}
