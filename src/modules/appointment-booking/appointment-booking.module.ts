import { Module } from '@nestjs/common';

import { BusinessesModule } from '../businesses/businesses.module';

import { ServicesCatalogModule } from '../services-catalog/services-catalog.module';

import { AppointmentAvailabilityModule } from '../appointment-availability/appointment-availability.module';

import { InteractionLogsModule } from '../interaction-logs/interaction-logs.module';

import { AppointmentBookingService } from './appointment-booking.service';

@Module({
  imports: [
    BusinessesModule,
    ServicesCatalogModule,
    AppointmentAvailabilityModule,
    InteractionLogsModule,
  ],

  providers: [AppointmentBookingService],

  exports: [AppointmentBookingService],
})
export class AppointmentBookingModule {}
