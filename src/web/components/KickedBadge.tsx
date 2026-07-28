export interface KickedBadgeProps {
  className?: string;
}

/**
 * The diagonal "Kicked" stamp `TapCard` overlays on a tap whose active keg is
 * `status: 'kicked'` — part of the drained/desaturated kicked-keg treatment
 * from the Task 4 plan. `role="status"` (not an alert — it's informational,
 * not something to interrupt for) so screen readers still announce it.
 */
export function KickedBadge({ className }: KickedBadgeProps) {
  const rootClassName = ['kicked-badge', className ?? ''].filter(Boolean).join(' ');

  return (
    <div className={rootClassName} role="status">
      <span className="kicked-badge__stamp">Kicked</span>
    </div>
  );
}
