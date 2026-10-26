import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { AppointmentCalendarSyncService } from './appointment-calendar-sync.service';

import { GoogleCalendarOAuthService } from './google-calendar-oauth.service';

@Controller()
export class GoogleCalendarController {
  constructor(
    private readonly googleCalendarOAuthService: GoogleCalendarOAuthService,

    private readonly appointmentCalendarSyncService: AppointmentCalendarSyncService,
  ) {}

  /* ─────────────────────────────────────────────
     OAUTH
  ───────────────────────────────────────────── */

  @Get('businesses/:businessId/integrations/google-calendar/auth-url')
  generateAuthUrl(
    @Param('businessId')
    businessId: string,
  ) {
    return this.googleCalendarOAuthService.generateAuthorizationUrl(businessId);
  }

  @Get('integrations/google-calendar/oauth/callback')
  callback(
    @Query('code')
    code: string,

    @Query('state')
    state: string,
  ) {
    return this.googleCalendarOAuthService.handleCallback(code, state);
  }

  /* ─────────────────────────────────────────────
     APPOINTMENT SYNC
  ───────────────────────────────────────────── */

  @Post(
    'businesses/:businessId/appointments/:appointmentId/google-calendar/sync',
  )
  syncCreate(
    @Param('businessId')
    businessId: string,

    @Param('appointmentId')
    appointmentId: string,
  ) {
    return this.appointmentCalendarSyncService.syncCreate(
      businessId,
      appointmentId,
    );
  }

  @Patch(
    'businesses/:businessId/appointments/:appointmentId/google-calendar/sync',
  )
  syncUpdate(
    @Param('businessId')
    businessId: string,

    @Param('appointmentId')
    appointmentId: string,
  ) {
    return this.appointmentCalendarSyncService.syncUpdate(
      businessId,
      appointmentId,
    );
  }

  @Delete(
    'businesses/:businessId/appointments/:appointmentId/google-calendar/sync',
  )
  syncDelete(
    @Param('businessId')
    businessId: string,

    @Param('appointmentId')
    appointmentId: string,
  ) {
    return this.appointmentCalendarSyncService.syncDelete(
      businessId,
      appointmentId,
    );
  }
}
