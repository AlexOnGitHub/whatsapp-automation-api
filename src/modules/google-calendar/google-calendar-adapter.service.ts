import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

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

    const eventId = createHash('sha256')
      .update(JSON.stringify([params.businessId, params.appointmentId]))
      .digest('hex');
    const requestBody = { ...this.buildEventResource(params), id: eventId };

    try {
      const response = await calendar.events.insert({
        calendarId,
        requestBody,
        sendUpdates: 'none',
      });

      return { event: response.data, created: true };
    } catch (error) {
      const response = (error as { response?: { status?: number } } | null)
        ?.response;

      if (response?.status !== 409) {
        throw error;
      }

      const { data: event } = await calendar.events.get({ calendarId, eventId });
      if (
        event.id !== eventId ||
        event.status === 'cancelled' ||
        event.extendedProperties?.private?.appointmentId !== params.appointmentId
      ) {
        throw error;
      }

      return { event, created: false };
    }
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

    await this.deleteCalendarEvent(calendar, calendarId, eventId);

    return { deleted: true, eventId };
  }

  async deleteUnlinkedAppointmentEvents(businessId: string, appointmentId: string) {
    const { calendar, calendarId } =
      await this.googleCalendarClientService.getCalendarClient(businessId);

    const eventIds: string[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await calendar.events.list({
        calendarId,
        privateExtendedProperty: [`appointmentId=${appointmentId}`],
        showDeleted: false,
        fields: 'nextPageToken,items(id)',
        pageToken,
      });

      for (const event of data.items ?? []) {
        if (event.id) eventIds.push(event.id);
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);

    for (const eventId of eventIds) {
      await this.deleteCalendarEvent(calendar, calendarId, eventId);
    }

    return eventIds[0];
  }

  private async deleteCalendarEvent(
    calendar: calendar_v3.Calendar,
    calendarId: string,
    eventId: string,
  ) {

    try {
      await calendar.events.delete({
        calendarId,
        eventId,
        sendUpdates: 'none',
      });
    } catch (error) {
      const response = (error as { response?: { status?: number } } | null)
        ?.response;

      // Calendar returns 410 when this event was already deleted.
      if (response?.status !== 410) {
        throw error;
      }
    }

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
