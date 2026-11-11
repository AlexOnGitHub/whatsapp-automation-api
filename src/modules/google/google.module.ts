import { Module } from '@nestjs/common';

import { BusinessesModule } from '../businesses/businesses.module';

import { IntegrationCryptoService } from '../../common/security/integration-crypto.service';

import { GoogleController } from './google.controller';

import { GoogleClientService } from './google-client.service';

import { GoogleCalendarConnectionService } from './google-calendar-connection.service';
import { GoogleOAuthService } from './google-oauth.service';

@Module({
  imports: [BusinessesModule],

  controllers: [GoogleController],

  providers: [
    IntegrationCryptoService,

    GoogleOAuthService,
    GoogleCalendarConnectionService,

    GoogleClientService,
  ],

  exports: [GoogleOAuthService, GoogleClientService],
})
export class GoogleModule {}
