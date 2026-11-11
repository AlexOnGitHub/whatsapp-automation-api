import { Injectable } from '@nestjs/common';

import { google } from 'googleapis';

import { GOOGLE_CALENDAR_DEFAULT_ID } from '../google/google.constants';

import { GoogleClientService } from '../google/google-client.service';

type GoogleWorkspaceSettings = {
  calendarId?: string;
};

@Injectable()
export class GoogleCalendarClientService {
  constructor(private readonly googleClientService: GoogleClientService) {}

  async getCalendarClient(businessId: string) {
    const { oauthClient, integration } =
      await this.googleClientService.getAuthenticatedClient(businessId);

    const settings = this.toObject(
      integration.settings,
    ) as GoogleWorkspaceSettings;

    const calendarId =
      typeof settings.calendarId === 'string' && settings.calendarId.trim()
        ? settings.calendarId
        : GOOGLE_CALENDAR_DEFAULT_ID;

    return {
      calendar: google.calendar({
        version: 'v3',

        auth: oauthClient,
        timeout: 15_000,
        retry: false,
      }),

      calendarId,

      integration,
    };
  }

  private toObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }
}
