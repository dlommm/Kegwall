import { useEffect, useState } from 'react';
import { getMenu, type PublicTap } from '../../lib/api';
import { beerColorFor } from '../../wall/wallModel';

/** How often the strip re-reads what's on tap. It only changes when a keg is tapped or kicked. */
const REFRESH_MS = 60_000;

/** The beer colours a tap list shows, in tap order: taps with a keg on, nothing else. */
export function stripColors(taps: Pick<PublicTap, 'tapNumber' | 'beer' | 'keg' | 'hidden'>[]): string[] {
  return [...taps]
    .filter((t) => t.beer && t.keg && t.keg.status === 'on_tap' && !t.hidden)
    .sort((a, b) => a.tapNumber - b.tapNumber)
    .map((t) => beerColorFor(t.beer!.srm));
}

/**
 * The 4 px strip of tonight's beer colours under the admin top bar (Kegwall 2.1, review item
 * "c-strip"): one segment per tap with a keg on. Decorative: the same facts are on Tonight
 * and Taps, so it stays out of the accessibility tree and renders nothing with no taps.
 */
export function TapStrip() {
  const [colors, setColors] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void getMenu().then((r) => { if (alive && r.ok) setColors(stripColors(r.data.taps)); });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  if (colors.length === 0) return null;
  return (
    <div className="adm-strip" aria-hidden="true" data-testid="admin-tap-strip">
      {colors.map((c, i) => <i key={i} style={{ background: c }} />)}
    </div>
  );
}
