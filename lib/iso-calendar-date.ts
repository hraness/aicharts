export const ISO_CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function isIsoCalendarDate(value: string): boolean {
  const match = value.match(ISO_CALENDAR_DATE_PATTERN);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isFinite(date.getTime())
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function isoCalendarDateToUtcDate(value: string): Date | null {
  return isIsoCalendarDate(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : null;
}
