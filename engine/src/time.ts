// Time helpers. All shift math is done in "week minutes" (dayIndex * 1440 + minutes)
// so cross-day rest gaps are trivial to compute. Overnight shifts (end <= start)
// are treated as ending the following day.

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Inverse of toMinutes for an intra-day value → 'HH:MM' (wraps at 24h). */
export function fromMinutes(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Shift length in minutes; if end <= start we assume it crosses midnight. */
export function shiftDuration(start: string, end: string): number {
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (e <= s) e += 24 * 60;
  return e - s;
}

export function absStart(dayIndex: number, start: string): number {
  return dayIndex * 1440 + toMinutes(start);
}

export function absEnd(dayIndex: number, start: string, end: string): number {
  return absStart(dayIndex, start) + shiftDuration(start, end);
}

/** Clock hour at which a shift ends. Overnight shifts return >= 24 (always past curfew). */
export function endHour(start: string, end: string): number {
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (e <= s) e += 24 * 60;
  return e / 60;
}
