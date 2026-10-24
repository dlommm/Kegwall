import type { CSSProperties } from 'react';
import type { WallTapModel } from './wallModel';
import { relativeLuminance } from '../lib/contrast';
import styles from './TapMarker.module.css';
import '../design/fonts';

export interface TapMarkerProps {
  model: Pick<WallTapModel, 'beerColor' | 'markerInk' | 'markerLetters' | 'tapNumber' | 'labelImage' | 'name'>;
  /** Edge length in stage design pixels (or CSS px outside a stage). */
  size?: number;
  /** Show the uploaded label art when the beer has some (default true). */
  showArt?: boolean;
  /** Show the tap number on the marker; off where the row already prints it. */
  showNumber?: boolean;
  className?: string;
}

/**
 * The tap marker: replaces label art as a beer's mark on every V2 surface. When a beer has
 * uploaded art, the art fills the marker and the tap number rides on it.
 */
export function TapMarker({
  model, size = 72, showArt = true, showNumber = true, className,
}: TapMarkerProps) {
  const style = {
    '--marker-size': size,
    '--marker-color': model.beerColor,
    '--marker-ink': model.markerInk,
  } as CSSProperties;
  const art = showArt ? model.labelImage : null;
  return (
    <span
      className={className ? `${styles.marker} ${className}` : styles.marker}
      style={style}
      data-dark-beer={relativeLuminance(model.beerColor) < 0.02 || undefined}
      data-testid="tap-marker"
      aria-label={model.name ? `Tap ${model.tapNumber}: ${model.name}` : `Tap ${model.tapNumber}`}
    >
      {art ? <img className={styles.art} src={art} alt="" /> : <span className={styles.letters}>{model.markerLetters}</span>}
      {showNumber && <span className={styles.number}>{model.tapNumber}</span>}
    </span>
  );
}
