import { Controller, Delete, Param, Patch, Post } from '@nestjs/common';

import { AppointmentCalendarSyncService } from './appointment-calendar-sync.service';

@Controller()
export class GoogleCalendarController {
  constructor(
    private readonly appointmentCalendarSyncService: AppointmentCalendarSyncService,
  ) {}

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
