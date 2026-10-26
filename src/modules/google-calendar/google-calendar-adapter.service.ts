import { Injectable } from '@nestjs/common';

import type { calendar_v3 } from 'googleapis';

import { GoogleCalendarClientService } from './google-calendar-client.service';

type CreateCalendarEventParams = {
  businessId: string;

  summary: string;

  description?: string;

  startTime: Date;

  endTime: Date;

  timeZone: string;

  appointmentId: string;
};

type UpdateCalendarEventParams = CreateCalendarEventParams & {
  eventId: string;
};

@Injectable()
export class GoogleCalendarAdapterService {
  constructor(
    private readonly googleCalendarClientService: GoogleCalendarClientService,
  ) {}

  /* ─────────────────────────────────────────────
     CREATE
  ───────────────────────────────────────────── */

  async createEvent(params: CreateCalendarEventParams) {
    const { calendar, calendarId } =
      await this.googleCalendarClientService.getCalendarClient(
        params.businessId,
      );

    const requestBody = this.buildEventResource(params);

    const response = await calendar.events.insert({
      calendarId,

      requestBody,

      sendUpdates: 'none',
    });

    return response.data;
  }

  /* ─────────────────────────────────────────────
     UPDATE
  ───────────────────────────────────────────── */

  async updateEvent(params: UpdateCalendarEventParams) {
    const { calendar, calendarId } =
      await this.googleCalendarClientService.getCalendarClient(
        params.businessId,
      );

    const requestBody = this.buildEventResource(params);

    const response = await calendar.events.update({
      calendarId,

      eventId: params.eventId,

      requestBody,

      sendUpdates: 'none',
    });

    return response.data;
  }

  /* ─────────────────────────────────────────────
     DELETE
  ───────────────────────────────────────────── */

  async deleteEvent(businessId: string, eventId: string) {
    const { calendar, calendarId } =
      await this.googleCalendarClientService.getCalendarClient(businessId);

    await calendar.events.delete({
      calendarId,

      eventId,

      sendUpdates: 'none',
    });

    return {
      deleted: true,
      eventId,
    };
  }

  /* ─────────────────────────────────────────────
     RESOURCE
  ───────────────────────────────────────────── */

  private buildEventResource(
    params: CreateCalendarEventParams,
  ): calendar_v3.Schema$Event {
    return {
      summary: params.summary,

      description: params.description,

      start: {
        dateTime: params.startTime.toISOString(),

        timeZone: params.timeZone,
      },

      end: {
        dateTime: params.endTime.toISOString(),

        timeZone: params.timeZone,
      },

      extendedProperties: {
        private: {
          appointmentId: params.appointmentId,
        },
      },

      transparency: 'opaque',
    };
  }
}
