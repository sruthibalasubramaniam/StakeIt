/** Date helpers shared by the deadline engine, pacing calculator and UI DTOs. */

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * MS_PER_HOUR);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_PER_MINUTE);
}

export function differenceInDays(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / MS_PER_DAY;
}

/** Whole days remaining, floored at 0 (never negative). */
export function daysRemaining(deadline: Date, now: Date = new Date()): number {
  const remaining = Math.ceil((deadline.getTime() - now.getTime()) / MS_PER_DAY);
  return Math.max(0, remaining);
}

export function isPast(deadline: Date, now: Date = new Date()): boolean {
  return deadline.getTime() <= now.getTime();
}

/** Fraction (0-1) of the attempt window that has elapsed. */
export function elapsedFraction(startedAt: Date, deadline: Date, now: Date = new Date()): number {
  const total = deadline.getTime() - startedAt.getTime();
  if (total <= 0) return 1;
  const elapsed = now.getTime() - startedAt.getTime();
  return Math.min(1, Math.max(0, elapsed / total));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundTo(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
