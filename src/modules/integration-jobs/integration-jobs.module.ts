import { Module } from '@nestjs/common';

import { BusinessesModule } from '../businesses/businesses.module';

import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';


import { IntegrationJobsService } from './integration-jobs.service';

import { IntegrationJobsProcessor } from './integration-jobs.processor';

import { IntegrationJobsWorker } from './integration-jobs.worker';

@Module({
  imports: [BusinessesModule, GoogleCalendarModule],


  providers: [
    IntegrationJobsService,

    IntegrationJobsProcessor,

    IntegrationJobsWorker,
  ],

  exports: [IntegrationJobsService, IntegrationJobsProcessor],
})
export class IntegrationJobsModule {}
