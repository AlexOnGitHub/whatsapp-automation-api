export type ParsedBusinessDate = {
  date: string;

  source: 'TODAY' | 'TOMORROW' | 'EXPLICIT';
};

/* ─────────────────────────────────────────────
   CURRENT BUSINESS DATE
───────────────────────────────────────────── */

export function getCurrentDateInTimeZone(
  timeZone: string,
  now = new Date(),
): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(now);

  const year = parts.find((part) => part.type === 'year')?.value;

  const month = parts.find((part) => part.type === 'month')?.value;

  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error(
      `No fue posible calcular la fecha para timezone ${timeZone}`,
    );
  }

  return `${year}-${month}-${day}`;
}

/* ─────────────────────────────────────────────
   DATE PARSER
───────────────────────────────────────────── */

export function parseBusinessDateInput(
  input: string,
  timeZone: string,
  now = new Date(),
): ParsedBusinessDate | null {
  const normalized = normalizeDateInput(input);

  if (!normalized) {
    return null;
  }

  const today = getCurrentDateInTimeZone(timeZone, now);

  if (normalized === 'hoy') {
    return {
      date: today,
      source: 'TODAY',
    };
  }

  if (normalized === 'manana') {
    return {
      date: addCalendarDays(today, 1),

      source: 'TOMORROW',
    };
  }

  /*
   * YYYY-MM-DD
   */
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoMatch) {
    const [, year, month, day] = isoMatch;

    const date = buildValidatedDate(Number(year), Number(month), Number(day));

    if (!date) {
      return null;
    }

    return {
      date,
      source: 'EXPLICIT',
    };
  }

  /*
   * DD/MM/YYYY
   * DD-MM-YYYY
   */
  const latinMatch = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

  if (latinMatch) {
    const [, day, month, year] = latinMatch;

    const date = buildValidatedDate(Number(year), Number(month), Number(day));

    if (!date) {
      return null;
    }

    return {
      date,
      source: 'EXPLICIT',
    };
  }

  return null;
}

/* ─────────────────────────────────────────────
   COMPARISON
───────────────────────────────────────────── */

export function isDateBefore(candidate: string, reference: string): boolean {
  /*
   * YYYY-MM-DD tiene orden lexicográfico
   * equivalente al orden cronológico.
   */
  return candidate < reference;
}

/* ─────────────────────────────────────────────
   DISPLAY
───────────────────────────────────────────── */

export function formatBusinessDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);

  if (!year || !month || !day) {
    return date;
  }

  const calendarDate = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'UTC',

    weekday: 'long',

    day: 'numeric',

    month: 'long',

    year: 'numeric',
  }).format(calendarDate);
}

/* ─────────────────────────────────────────────
   INTERNAL HELPERS
───────────────────────────────────────────── */

function normalizeDateInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function buildValidatedDate(
  year: number,
  month: number,
  day: number,
): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return [
    year.toString().padStart(4, '0'),

    month.toString().padStart(2, '0'),

    day.toString().padStart(2, '0'),
  ].join('-');
}

function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);

  const result = new Date(Date.UTC(year, month - 1, day + days));

  return [
    result.getUTCFullYear().toString().padStart(4, '0'),

    (result.getUTCMonth() + 1).toString().padStart(2, '0'),

    result.getUTCDate().toString().padStart(2, '0'),
  ].join('-');
}
