import type { CSSProperties, ReactNode } from 'react';
import type { TapState } from '../../../server/core/state.js';
import { formatVolumeMl, type VolumeUnits } from '../../lib/units';
import { initials } from '../../lib/initials';
import { pickInk } from '../../lib/contrast';
import { beerColorFor } from '../../wall/wallModel';
import { PourGlass, glassFraction, servingMarks } from '../../wall/pour/pourKit';
import type { KioskPourer } from './KioskWho';
import '../../design/fonts';

export interface KioskDonePour {
  volumeMl: number;
  beerName: string | null;
  tapNumber: number | null;
  pourCount: number;
}

interface Common {
  pourer: KioskPourer;
  units: VolumeUnits;
  servingSizeMl: number;
  reducedMotion: boolean;
}

function Who({ pourer }: { pourer: KioskPourer }) {
  return (
    <span className="kiosk-avatar kiosk-avatar--big" style={{ backgroundColor: pourer.color ?? '#7A6C58' }} aria-hidden="true">
      {initials(pourer.name)}
    </span>
  );
}

/** The glass on the right of every kiosk pour state: dashed and empty while armed, filling by
 * the measured volume while beer flows, settled on the recorded volume when done. */
function KioskGlass({ state, ml, servingSizeMl, units, reducedMotion }: {
  state: 'armed' | 'pouring' | 'done';
  ml: number;
  servingSizeMl: number;
  units: VolumeUnits;
  reducedMotion: boolean;
}) {
  if (state === 'armed') {
    return (
      <div className="kiosk-glass" data-state="armed" aria-hidden="true">
        <svg className="kiosk-glass__empty" viewBox="0 0 220 300" width="220" height="300">
          <path d="M8 6 L28 292 L192 292 L212 6" />
        </svg>
      </div>
    );
  }
  return (
    <div className="kiosk-glass" data-state={state}>
      <PourGlass
        frac={glassFraction(ml, servingSizeMl)}
        flowing={state === 'pouring' && !reducedMotion}
        finished={state === 'done'}
        width={220}
        height={300}
        marks={servingMarks(servingSizeMl, units)}
      />
    </div>
  );
}

/** The poured beer filling the whole tablet from the bottom (Kegwall 2.1 "g-pour"), with
 * the words switching to the beer's ink once it's over half full. Transform only. */
function flood(color: string | null, frac: number): { style: CSSProperties; ink: boolean } {
  const f = Math.max(0, Math.min(1, frac));
  return {
    style: { '--flood': color ?? 'var(--accent)', '--flood-level': f, '--flood-ink': color ? pickInk(color) : '#1A0F06' } as CSSProperties,
    ink: f > 0.55,
  };
}

/** Every tap's handle in its beer's color along the bottom while armed; the flowing one rises. */
function Handles({ taps, live }: { taps: TapState[]; live: number | null }) {
  const on = [...taps].filter((t) => t.beer && t.keg?.status === 'on_tap').sort((a, b) => a.tapNumber - b.tapNumber);
  if (on.length === 0) return null;
  return (
    <span className="kiosk-handles" aria-hidden="true">
      {on.map((t) => (
        <i key={t.tapId} data-live={t.tapNumber === live || undefined} style={{ background: beerColorFor(t.beer!.srm) }} />
      ))}
    </span>
  );
}

/**
 * Armed and pouring (Kegwall V2 M10, blueprint §E.6; fixes issue 14): one full-screen
 * composition, the pourer and an instruction headline on the left and the glass on the right.
 * Armed shows a dashed empty glass; once the Kegtron reports a flow the glass fills with the
 * live measured volume. Attribution is unchanged: the tablet is armed for this pourer until the
 * pour is recorded or they sign out.
 */
export function KioskArmed({
  pourer, units, servingSizeMl, reducedMotion, pouringTap, taps = [], onSignOut, children,
}: Common & { pouringTap: TapState | undefined; taps?: TapState[]; onSignOut: () => void; children?: ReactNode }) {
  const ml = pouringTap?.curServMl ?? 0;
  const [value, unit] = formatVolumeMl(ml, units).split(' ');
  const fl = flood(pouringTap?.beer ? beerColorFor(pouringTap.beer.srm) : null, pouringTap ? glassFraction(ml, servingSizeMl) : 0);
  return (
    <div
      className="tablet-screen kiosk-pour"
      data-testid="tablet-armed"
      data-pouring={pouringTap ? 'true' : undefined}
      data-ink={fl.ink || undefined}
      style={fl.style}
    >
      <span className="kiosk-flood" aria-hidden="true" />
      <div className="kiosk-pour__say">
        <div className="tablet-armed__who">
          <Who pourer={pourer} />
          <span className="tablet-armed__hint">
            {'You’re up, '}
            <b>{pourer.name}</b>
            {' — pour from any tap'}
          </span>
        </div>
        {pouringTap ? (
          <>
            <span className="tablet-armed__detected" data-testid="tablet-detected">
              <span className={reducedMotion ? 'look-pour-dot' : 'look-pour-dot look-pour-dot--pulse'} />
              {`DETECTED · TAP ${pouringTap.tapNumber}${pouringTap.beer ? ` · ${pouringTap.beer.name.toUpperCase()}` : ''}`}
            </span>
            <div className="tablet-armed__counter" data-testid="tablet-counter">
              <span className="tablet-armed__counter-value font-tabular">{value}</span>
              <span className="tablet-armed__counter-unit">{(unit ?? '').toUpperCase()}</span>
            </div>
          </>
        ) : (
          <>
            <h1 className="kiosk-pour__headline">Pull any tap.</h1>
            <span className="tablet-armed__waiting" data-testid="tablet-waiting">
              No beer selection needed — Kegtron knows which tap is flowing
            </span>
          </>
        )}
        {children}
        <button type="button" className="tablet-secondary tablet-armed__signout" data-testid="tablet-signout" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      <KioskGlass state={pouringTap ? 'pouring' : 'armed'} ml={ml} servingSizeMl={servingSizeMl} units={units} reducedMotion={reducedMotion} />
      <Handles taps={taps} live={pouringTap?.tapNumber ?? null} />
    </div>
  );
}

/** Done: the recorded volume on the pourer's name, then the 5 s auto sign-out. Tap anywhere to stay. */
export function KioskDone({
  pourer, units, servingSizeMl, reducedMotion, pour, beerColor = null, countdown, onStay,
}: Common & { pour: KioskDonePour; beerColor?: string | null; countdown: number; onStay: () => void }) {
  const fl = flood(beerColor, glassFraction(pour.volumeMl, servingSizeMl));
  return (
    <button
      type="button"
      className="tablet-screen kiosk-pour tablet-done"
      data-testid="tablet-done"
      data-ink={fl.ink || undefined}
      style={fl.style}
      onClick={onStay}
    >
      <span className="kiosk-flood kiosk-flood--settled" aria-hidden="true" />
      <span className="kiosk-pour__say">
        <span className="tablet-armed__who">
          <Who pourer={pourer} />
          <span className="tablet-done__check" aria-hidden="true">✓</span>
        </span>
        <span className="tablet-done__title">{`Cheers, ${pourer.name}`}</span>
        <span className="tablet-done__detail">
          <b>
            {formatVolumeMl(pour.volumeMl, units)}
            {pour.beerName ? ` of ${pour.beerName}` : ''}
          </b>
          {` logged to you · pour #${pour.pourCount}`}
        </span>
        <span className="tablet-done__countdown font-tabular" data-testid="tablet-countdown">
          {`Signing out in ${countdown}s — tap to stay`}
        </span>
      </span>
      <KioskGlass state="done" ml={pour.volumeMl} servingSizeMl={servingSizeMl} units={units} reducedMotion={reducedMotion} />
    </button>
  );
}
