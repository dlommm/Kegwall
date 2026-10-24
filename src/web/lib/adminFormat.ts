// Small formatters the admin pages share (owner money, short dates).

/** Owner-cost cents → "$1,472" for whole dollars, "$3.67" otherwise, or "—" with no value. */
export function money(cents: number | null): string {
  if (cents == null) return '—';
  const whole = Math.round(cents) % 100 === 0;
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
  });
}

/** "2026-10" → "October 2026". Anything else is returned as it came. */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** "$1,268": a total, to the dollar. */
export function wholeMoney(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

/** "Oct 22" from an ISO timestamp or a YYYY-MM-DD date (read as that local day). */
export function shortDate(value: string): string {
  return localDate(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** A Date for a timestamp, or local noon for a bare YYYY-MM-DD so it never slips a day. */
export function localDate(value: string): Date {
  return new Date(value.length === 10 ? `${value}T12:00:00` : value);
}
