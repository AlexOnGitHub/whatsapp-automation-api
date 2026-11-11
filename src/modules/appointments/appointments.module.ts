import { Module } from '@nestjs/common';

import { BusinessesModule } from '../businesses/businesses.module';

import { BusinessConfigsModule } from '../business-configs/business-configs.module';

import { CustomersModule } from '../customers/customers.module';

import { ServicesCatalogModule } from '../services-catalog/services-catalog.module';

import { AppointmentAvailabilityModule } from '../appointment-availability/appointment-availability.module';

import { InteractionLogsModule } from '../interaction-logs/interaction-logs.module';

import { AppointmentsController } from './appointments.controller';

import { AppointmentsService } from './appointments.service';

import { AppointmentRescheduleService } from './appointment-reschedule.service';

import { IntegrationJobsModule } from '../integration-jobs/integration-jobs.module';

@Module({
  imports: [
    BusinessesModule,
    BusinessConfigsModule,
    CustomersModule,
    ServicesCatalogModule,
    AppointmentAvailabilityModule,
    InteractionLogsModule,
    IntegrationJobsModule,
  ],

  controllers: [AppointmentsController],

  providers: [AppointmentsService, AppointmentRescheduleService],

  exports: [AppointmentsService, AppointmentRescheduleService],
})
export class AppointmentsModule {}
