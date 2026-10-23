// Small formatters the admin pages share (owner money, short dates).

/** Owner-cost cents → "$12.00", or "—" with no value. Admin-only surfaces. */
export function money(cents: number | null): string {
  return cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;
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
