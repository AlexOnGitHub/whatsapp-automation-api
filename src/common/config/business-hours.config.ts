export const BUSINESS_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type BusinessWeekday = (typeof BUSINESS_WEEKDAYS)[number];

export type BusinessDaySchedule = {
  enabled: boolean;

  open: string | null;

  close: string | null;

  slotIntervalMinutes: number;
};

export type BusinessHoursConfig = Record<BusinessWeekday, BusinessDaySchedule>;

const DEFAULT_SLOT_INTERVAL_MINUTES = 30;

const DAY_ALIASES: Record<BusinessWeekday, string[]> = {
  monday: ['monday', 'lunes'],

  tuesday: ['tuesday', 'martes'],

  wednesday: ['wednesday', 'miercoles', 'miércoles'],

  thursday: ['thursday', 'jueves'],

  friday: ['friday', 'viernes'],

  saturday: ['saturday', 'sabado', 'sábado'],

  sunday: ['sunday', 'domingo'],
};

export function parseBusinessHoursConfig(value: unknown): BusinessHoursConfig {
  const result = createClosedWeek();

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return result;
  }

  const candidate = value as Record<string, unknown>;

  const source =
    candidate.days &&
    typeof candidate.days === 'object' &&
    !Array.isArray(candidate.days)
      ? (candidate.days as Record<string, unknown>)
      : candidate;

  for (const weekday of BUSINESS_WEEKDAYS) {
    const rawDay = findDayConfig(source, weekday);

    if (!rawDay || typeof rawDay !== 'object' || Array.isArray(rawDay)) {
      continue;
    }

    const day = rawDay as Record<string, unknown>;

    const open = firstString(day.open, day.openTime, day.start);

    const close = firstString(day.close, day.closeTime, day.end);

    const enabled =
      day.enabled !== false && isValidTime(open) && isValidTime(close);

    const rawInterval =
      typeof day.slotIntervalMinutes === 'number'
        ? day.slotIntervalMinutes
        : typeof candidate.slotIntervalMinutes === 'number'
          ? candidate.slotIntervalMinutes
          : DEFAULT_SLOT_INTERVAL_MINUTES;

    result[weekday] = {
      enabled,

      open: enabled ? open : null,

      close: enabled ? close : null,

      slotIntervalMinutes:
        Number.isInteger(rawInterval) && rawInterval > 0
          ? rawInterval
          : DEFAULT_SLOT_INTERVAL_MINUTES,
    };
  }

  return result;
}

function createClosedWeek(): BusinessHoursConfig {
  return {
    monday: closedDay(),

    tuesday: closedDay(),

    wednesday: closedDay(),

    thursday: closedDay(),

    friday: closedDay(),

    saturday: closedDay(),

    sunday: closedDay(),
  };
}

function closedDay(): BusinessDaySchedule {
  return {
    enabled: false,
    open: null,
    close: null,
    slotIntervalMinutes: DEFAULT_SLOT_INTERVAL_MINUTES,
  };
}

function findDayConfig(
  source: Record<string, unknown>,
  weekday: BusinessWeekday,
): unknown {
  for (const alias of DAY_ALIASES[weekday]) {
    if (Object.prototype.hasOwnProperty.call(source, alias)) {
      return source[alias];
    }
  }

  return undefined;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      return value;
    }
  }

  return null;
}

function isValidTime(value: string | null): value is string {
  if (!value) {
    return false;
  }

  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
