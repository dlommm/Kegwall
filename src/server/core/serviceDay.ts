/**
 * "Tonight" on a Kegwall V2 wall ("142 oz poured tonight") means the current SERVICE day, not
 * the calendar day: a taproom open past midnight is still on the same night at 1 am. The
 * night rolls over at 04:00 server-local time.
 */
export const SERVICE_DAY_START_HOUR = 4;

/** Start of the service day containing `now` (04:00 local, today or yesterday). */
export function serviceDayStart(now: Date): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), SERVICE_DAY_START_HOUR);
  if (now.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
  return start;
}
