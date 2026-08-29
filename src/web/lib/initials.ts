/**
 * Avatar initials from a display name: first letter of the first + last words
 * ("Sam Vimes" → "SV"), a single letter for one-word names, '?' for blank input.
 * Shared by every avatar chip (leaderboard, game strip, admin layout, pourers,
 * tablet) — previously five identical hand-rolled copies.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase();
}
