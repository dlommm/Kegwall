import type { Banner } from '../lib/useBanners';

export interface BannerLaneProps {
  /** The pending banner queue; only the front entry is ever shown. */
  queue: Banner[];
  onDismiss: (id: string) => void;
}

/**
 * A fixed lane rendering the front of the wall's banner queue (see `useBanners`): slides
 * in via CSS (`.banner-lane__banner`'s entrance animation, keyed on the banner's own
 * `id` so a new banner replacing the old one replays it), holds until `useBanners`'
 * auto-dismiss timer fires, and offers a manual dismiss control too.
 */
export function BannerLane({ queue, onDismiss }: BannerLaneProps) {
  const current = queue[0] ?? null;

  return (
    <div className="banner-lane" data-testid="banner-lane">
      {current && (
        <div
          key={current.id}
          className={`banner-lane__banner banner-lane__banner--${current.kind}`}
          data-testid="banner-lane-banner"
          data-kind={current.kind}
          role="status"
        >
          <span className="banner-lane__text font-body">{current.text}</span>
          <button
            type="button"
            className="banner-lane__dismiss"
            aria-label="Dismiss"
            onClick={() => onDismiss(current.id)}
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}
