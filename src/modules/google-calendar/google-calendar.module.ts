import { Module } from '@nestjs/common';

import { BusinessesModule } from '../businesses/businesses.module';

import { GoogleModule } from '../google/google.module';

import { GoogleCalendarController } from './google-calendar.controller';

import { GoogleCalendarClientService } from './google-calendar-client.service';

import { GoogleCalendarAdapterService } from './google-calendar-adapter.service';

import { AppointmentCalendarSyncService } from './appointment-calendar-sync.service';

@Module({
  imports: [BusinessesModule, GoogleModule],

  controllers: [GoogleCalendarController],

  providers: [
    GoogleCalendarClientService,

    GoogleCalendarAdapterService,

    AppointmentCalendarSyncService,
  ],

  exports: [
    GoogleCalendarClientService,

    GoogleCalendarAdapterService,

    AppointmentCalendarSyncService,
  ],
})
export class GoogleCalendarModule {}
