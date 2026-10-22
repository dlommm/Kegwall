import type { WallTapModel } from './wallModel';
import styles from './PintsLeft.module.css';

export interface PintsLeftProps {
  model: Pick<WallTapModel, 'servingsLabel' | 'isKicked' | 'isLow' | 'hasBeer'>;
  className?: string;
}

/** "≈ 32 pints left": the keg unit on every V2 surface (blueprint §C.1). */
export function PintsLeft({ model, className }: PintsLeftProps) {
  const state = model.isKicked ? 'kicked' : !model.hasBeer ? 'empty' : model.isLow ? 'low' : 'ok';
  return (
    <span className={className ? `${styles.left} ${className}` : styles.left} data-state={state} data-testid="pints-left">
      {model.servingsLabel}
    </span>
  );
}
