export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** 00:00 UTC of the given date. */
export function startOfUtcDay(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** First day of the month (UTC) – traffic allowances reset monthly. */
export function startOfUtcMonth(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY);
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
