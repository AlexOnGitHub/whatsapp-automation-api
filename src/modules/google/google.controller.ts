import { ApiAccess } from '../../common/security/api-access.guard';
import { Controller, Get, Param, Patch, Query, ParseBoolPipe } from '@nestjs/common';

import { GoogleCalendarConnectionService } from './google-calendar-connection.service';
import { GoogleOAuthService } from './google-oauth.service';

@Controller()
export class GoogleController {
  constructor(
    private readonly googleOAuthService: GoogleOAuthService,
    private readonly calendarConnection: GoogleCalendarConnectionService,
  ) {}

  /* ─────────────────────────────────────────────
     OAUTH
  ───────────────────────────────────────────── */

  @Get('businesses/:businessId/integrations/google/auth-url')
  generateAuthUrl(
    @Param('businessId')
    businessId: string,
    @Query('calendarId') calendarId?: string,
  ) {
    return this.googleOAuthService.generateAuthorizationUrl(businessId, calendarId);
  }

  @Get('businesses/:businessId/integrations/google/connection')
  getConnection(@Param('businessId') businessId: string) {
    return this.calendarConnection.getConnection(businessId);
  }

  @Patch('businesses/:businessId/integrations/google/connection/:confirmationId')
  confirmDestination(
    @Param('businessId') businessId: string,
    @Param('confirmationId') confirmationId: string,
    @Query('preserveLegacyLinks', new ParseBoolPipe({ optional: true }))
    preserveLegacyLinks?: boolean,
  ) {
    return this.calendarConnection.confirm(businessId, confirmationId, preserveLegacyLinks);
  }

  @ApiAccess('public')
  @Get('integrations/google/oauth/callback')
  callback(
    @Query('code')
    code: string,

    @Query('state')
    state: string,
  ) {
    return this.googleOAuthService.handleCallback(code, state);
  }
}
