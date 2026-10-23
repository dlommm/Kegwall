import type { CSSProperties } from 'react';
import type { WallConfig } from '../../../server/core/wallConfig.js';
import type { VolumeUnits } from '../../lib/units';
import { wallTapModel } from '../wallModel';
import { TapMarker } from '../TapMarker';
import {
  EasedVolume, PourGlass, glassFraction, laneVolumeMl, servingMarks, volumeParts,
} from './pourKit';
import type { PourLane } from './usePourLanes';
import { GameOn, useGame } from './GameOn';
import styles from './PourLayer.module.css';

/** Takeover styles drawn as an overlay. Spotlight and Badge (`off`) decorate the look instead. */
export const OVERLAY_STYLES = ['full', 'split', 'dock', 'fill', 'tappull', 'kegdrain', 'gameon'] as const;
/** The full-screen styles a single pour can finish with Cheers on. */
const CHEERS_STYLES = ['full', 'split', 'fill', 'tappull', 'kegdrain'];
/** More lanes than this and the oldest are summarized in a chip. */
export const MAX_LANES = 4;

export interface PourLayerProps {
  style: WallConfig['takeover']['style'];
  lanes: PourLane[];
  units: VolumeUnits;
  servingSizeMl: number;
  /** `takeover.finish`: 'cheers' ends a single full-screen pour with the Cheers moment. */
  finish?: WallConfig['takeover']['finish'];
}

function firstName(name: string | null): string | null {
  return name ? name.trim().split(/\s+/)[0] ?? null : null;
}

/** "Pouring on tap 1 for Alex" / "Poured on tap 1". */
function whoLine(lane: PourLane): string {
  const done = lane.phase !== 'pouring';
  const who = lane.pourerName ? ` for ${lane.pourerName}` : '';
  return `${done ? 'Poured' : 'Pouring'} on tap ${lane.tap.tapNumber}${who}`;
}

/** "Measured by the Kegtron as it flows" / "Recorded 412 mL in 6.1 s". */
function sourceLine(lane: PourLane, units: VolumeUnits): string {
  if (lane.phase === 'pouring') return 'Measured by the Kegtron as it flows';
  if (lane.recordedMl == null) return 'Last reading from the Kegtron';
  const v = volumeParts(lane.recordedMl, units);
  const secs = lane.durationMs ? ` in ${(lane.durationMs / 1000).toFixed(1)} s` : '';
  return `Recorded ${v.value} ${v.unit}${units === 'us' ? ` · ${Math.round(lane.recordedMl)} mL` : ''}${secs}`;
}

function laneVars(lane: PourLane): CSSProperties {
  const m = wallTapModel(lane.tap, { units: 'us', servingSizeMl: 473 });
  return { '--beer': m.beerColor, '--beer-ink': m.markerInk } as CSSProperties;
}

/**
 * The pour takeover layer (Kegwall V2, blueprint §C.1 v0.5–v0.7), drawn on the stage above the
 * look. Every style adapts to however many taps are pouring: one lane per pour, up to four,
 * then a chip for the rest.
 */
export function PourLayer(props: PourLayerProps) {
  const { style, lanes } = props;
  // Game On needs a running game; the hook only polls while that style has a pour.
  const game = useGame(style === 'gameon' && lanes.length > 0);
  if (!(OVERLAY_STYLES as readonly string[]).includes(style) || lanes.length === 0) return null;
  // Game On without a game, and Keg Drain / Tap Pull with several pours, fall back to lanes.
  if (style === 'gameon' && game) return <GameOn game={game} lanes={lanes} units={props.units} />;
  const effective = style === 'gameon' || (lanes.length > 1 && (style === 'kegdrain' || style === 'tappull')) ? 'full' : style;
  return <Lanes {...props} style={effective} />;
}

function Lanes({
  style, lanes, units, servingSizeMl, finish = 'plain',
}: PourLayerProps) {
  const shown = lanes.slice(-MAX_LANES);
  const hidden = lanes.length - shown.length;
  const marks = servingMarks(servingSizeMl, units);

  return (
    <div
      className={styles.layer}
      data-style={style}
      data-lanes={shown.length}
      data-testid={`takeover-${style}`}
      aria-live="polite"
    >
      {shown.map((lane) => {
        const ml = laneVolumeMl(lane);
        const frac = glassFraction(ml, servingSizeMl);
        const finished = lane.phase !== 'pouring';
        const name = lane.tap.beer?.name ?? `Tap ${lane.tap.tapNumber}`;
        const model = wallTapModel(lane.tap, { units, servingSizeMl });
        return (
          <section
            key={lane.key}
            className={styles.lane}
            data-phase={lane.phase}
            style={{ ...laneVars(lane), '--frac': frac.toFixed(3) } as CSSProperties}
            data-testid="pour-lane"
          >
            {style === 'full' && (
              <div className={styles.fullBody}>
                <div className={styles.copy}>
                  <span className={styles.who}>{whoLine(lane)}</span>
                  <h2 className={styles.name}>{name}</h2>
                  <EasedVolume className={styles.counter} ml={ml} units={units} final={finished} />
                  <span className={styles.src}>{sourceLine(lane, units)}</span>
                  {finished && (
                    <div className={styles.fin}>
                      <b>{firstName(lane.pourerName) ? `Cheers, ${firstName(lane.pourerName)}` : 'Cheers'}</b>
                    </div>
                  )}
                </div>
                <PourGlass
                  frac={frac}
                  flowing={!finished && ml > 0}
                  finished={finished}
                  width={shown.length === 1 ? 520 : 360}
                  height={shown.length === 1 ? 760 : shown.length > 2 ? 340 : 400}
                  marks={shown.length === 1 ? marks : []}
                />
              </div>
            )}
            {style === 'split' && (
              <div className={styles.splitBody}>
                <span className={styles.liquid} />
                <span className={styles.numeral} aria-hidden="true">{lane.tap.tapNumber}</span>
                <div className={styles.inkCopy}>
                  <span className={styles.who}>{whoLine(lane)}</span>
                  <h2 className={styles.name}>{name}</h2>
                  <EasedVolume className={styles.counter} ml={ml} units={units} final={finished} />
                  {finished && <span className={styles.src}>{sourceLine(lane, units)}</span>}
                </div>
              </div>
            )}
            {style === 'dock' && (
              <div className={styles.dockBody}>
                <span className={styles.bar} />
                <span className={styles.sheen} />
                <TapMarker model={model} size={shown.length > 2 ? 72 : 104} />
                <div className={styles.dockCopy}>
                  <h2 className={styles.name}>{name}</h2>
                  <span className={styles.who}>{finished ? sourceLine(lane, units) : whoLine(lane)}</span>
                </div>
                <EasedVolume className={styles.counter} ml={ml} units={units} final={finished} />
                {finished && (
                  <span className={styles.pill}>{`+${volumeParts(ml, units).value} ${volumeParts(ml, units).unit}`}</span>
                )}
              </div>
            )}
            {style === 'fill' && (
              <div className={styles.fillBody}>
                <span className={styles.etch} aria-hidden="true">{name}</span>
                <span className={styles.flood} />
                <div className={styles.fillCopy}>
                  <h2 className={styles.name}>{name}</h2>
                  <EasedVolume className={styles.counter} ml={ml} units={units} final={finished} />
                  <span className={styles.src}>{`Tap ${lane.tap.tapNumber} · ${finished ? sourceLine(lane, units).toLowerCase() : 'measured live'}`}</span>
                </div>
              </div>
            )}
            {style === 'tappull' && (
              <div className={styles.pullBody}>
                <div className={styles.pullRig}>
                  <div className={styles.tower} />
                  <div className={styles.handle} data-pulled={finished ? undefined : 'true'}>
                    <b>{`Tap ${lane.tap.tapNumber}`}</b>
                    <span>{model.markerLetters}</span>
                  </div>
                  <div className={styles.faucet} />
                  <div className={styles.pullGlass}>
                    <PourGlass frac={frac} flowing={!finished && ml > 0} finished={finished} width={280} height={330} tilted />
                  </div>
                </div>
                <div className={styles.copy}>
                  <span className={styles.who}>{lane.pourerName ? `${lane.pourerName} ${finished ? 'poured' : 'pulled'} tap ${lane.tap.tapNumber}` : whoLine(lane)}</span>
                  <h2 className={styles.name}>{name}</h2>
                  <EasedVolume className={styles.counter} ml={ml} units={units} final={finished} />
                  <span className={styles.src}>{sourceLine(lane, units)}</span>
                </div>
              </div>
            )}
            {style === 'kegdrain' && (() => {
              const keg = lane.tap.keg;
              const startMl = keg ? keg.remainingMl : 0;
              const leftMl = Math.max(0, startMl - ml);
              const startLevel = keg && keg.volStartMl > 0 ? startMl / keg.volStartMl : 0;
              const level = keg && keg.volStartMl > 0 ? leftMl / keg.volStartMl : 0;
              const full = keg ? Math.floor(keg.volStartMl / servingSizeMl) : 0;
              return (
                <div className={styles.drainBody}>
                  <div className={styles.keg} style={{ '--level': level.toFixed(4), '--start': startLevel.toFixed(4) } as CSSProperties}>
                    <span className={styles.kegLiquid} />
                    <span className={styles.ghost} />
                  </div>
                  <div className={styles.copy}>
                    <span className={styles.who}>{`Tap ${lane.tap.tapNumber} · ${name}`}</span>
                    <h2 className={styles.name}>{`${model.servingNoun === 'pint' ? 'Pints' : 'Pours'} left`}</h2>
                    <span className={styles.pints}>
                      <b>{(leftMl / servingSizeMl).toFixed(2)}</b>
                      <span>{`of ${full}`}</span>
                    </span>
                    <span className={styles.src}>
                      {`${volumeParts(ml, units).value} ${volumeParts(ml, units).unit} ${finished ? 'poured' : 'pouring now'}`}
                      {model.kicksInDays != null ? ` · kicks in about ${model.kicksInDays} ${model.kicksInDays === 1 ? 'day' : 'days'}` : ''}
                    </span>
                  </div>
                </div>
              );
            })()}
            {finish === 'cheers' && finished && shown.length === 1 && CHEERS_STYLES.includes(style) && (
              <div className={styles.cheers} data-testid="pour-cheers">
                <div className={styles.pair} aria-hidden="true"><i /><i /></div>
                <h2 className={styles.name}>{firstName(lane.pourerName) ? `Cheers, ${firstName(lane.pourerName)}` : 'Cheers'}</h2>
                <p>{`${volumeParts(ml, units).value} ${volumeParts(ml, units).unit} of ${name}${lane.recordedMl != null ? ' · recorded' : ''}`}</p>
                {lane.pourerPourCount != null && <span className={styles.passport}>{`Passport · pour ${lane.pourerPourCount}`}</span>}
              </div>
            )}
          </section>
        );
      })}
      {hidden > 0 && <span className={styles.chip}>{`+${hidden} more pouring`}</span>}
    </div>
  );
}
