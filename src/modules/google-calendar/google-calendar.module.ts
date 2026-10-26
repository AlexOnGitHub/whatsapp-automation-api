import { Module } from '@nestjs/common';

import { BusinessesModule } from '../businesses/businesses.module';

import { IntegrationCryptoService } from '../../common/security/integration-crypto.service';

import { GoogleCalendarController } from './google-calendar.controller';

import { GoogleCalendarOAuthService } from './google-calendar-oauth.service';

import { GoogleCalendarClientService } from './google-calendar-client.service';

import { GoogleCalendarAdapterService } from './google-calendar-adapter.service';

import { AppointmentCalendarSyncService } from './appointment-calendar-sync.service';

@Module({
  imports: [BusinessesModule],

  controllers: [GoogleCalendarController],

  providers: [
    IntegrationCryptoService,

    GoogleCalendarOAuthService,

    GoogleCalendarClientService,

    GoogleCalendarAdapterService,

    AppointmentCalendarSyncService,
  ],

  exports: [
    IntegrationCryptoService,

    GoogleCalendarOAuthService,

    GoogleCalendarClientService,

    GoogleCalendarAdapterService,

    AppointmentCalendarSyncService,
  ],
})
export class GoogleCalendarModule {}
