export const GOOGLE_PROVIDER = 'GOOGLE';

export const GOOGLE_WORKSPACE_INTEGRATION_TYPE = 'WORKSPACE';

export const GOOGLE_CALENDAR_DEFAULT_ID = 'primary';

export const GOOGLE_CALENDAR_SCOPE =
  'https://www.googleapis.com/auth/calendar.events';

export const GOOGLE_SHEETS_SCOPE =
  'https://www.googleapis.com/auth/spreadsheets';

export const GOOGLE_WORKSPACE_SCOPES = [
  GOOGLE_CALENDAR_SCOPE,
  'https://www.googleapis.com/auth/calendar.calendars.readonly',
  GOOGLE_SHEETS_SCOPE,
] as const;

export function googleWorkspaceLockKey(businessId: string) {
  return JSON.stringify(['google-workspace', businessId]);
}
