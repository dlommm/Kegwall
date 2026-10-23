import type { ReactNode } from 'react';
import type { TapState } from '../../../server/core/state.js';
import { formatVolumeMl, type VolumeUnits } from '../../lib/units';
import { initials } from '../../lib/initials';
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

/**
 * Armed and pouring (Kegwall V2 M10, blueprint §E.6; fixes issue 14): one full-screen
 * composition, the pourer and an instruction headline on the left and the glass on the right.
 * Armed shows a dashed empty glass; once the Kegtron reports a flow the glass fills with the
 * live measured volume. Attribution is unchanged: the tablet is armed for this pourer until the
 * pour is recorded or they sign out.
 */
export function KioskArmed({
  pourer, units, servingSizeMl, reducedMotion, pouringTap, onSignOut, children,
}: Common & { pouringTap: TapState | undefined; onSignOut: () => void; children?: ReactNode }) {
  const ml = pouringTap?.curServMl ?? 0;
  const [value, unit] = formatVolumeMl(ml, units).split(' ');
  return (
    <div className="tablet-screen kiosk-pour" data-testid="tablet-armed" data-pouring={pouringTap ? 'true' : undefined}>
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
    </div>
  );
}

/** Done: the recorded volume on the pourer's name, then the 5 s auto sign-out. Tap anywhere to stay. */
export function KioskDone({
  pourer, units, servingSizeMl, reducedMotion, pour, countdown, onStay,
}: Common & { pour: KioskDonePour; countdown: number; onStay: () => void }) {
  return (
    <button type="button" className="tablet-screen kiosk-pour tablet-done" data-testid="tablet-done" onClick={onStay}>
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
