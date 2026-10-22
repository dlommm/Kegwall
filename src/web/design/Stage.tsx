import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import styles from './Stage.module.css';

export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

export interface StageProps {
  /**
   * `screen`: the wall itself, filling the viewport (letterboxed in the theme ground).
   * `fit`: a 16:9 box that fills its container's width (the Wall Editor preview); the stage
   * inside is a real 1920 × 1080 layout scaled down with a transform.
   */
  mode?: 'screen' | 'fit';
  /** The wall's `display.uiScale`; multiplies every stage dimension through `--u`. */
  uiScale?: number;
  /** Which surface this is, for custom-CSS hooks (`[data-surface="wall"]`). */
  surface?: string;
  className?: string;
  children: ReactNode;
}

/**
 * The 1920 × 1080 stage every V2 wall look renders on (ADR-0001 §5). Children size themselves
 * in design pixels with `calc(N * var(--u))` and the `--tv-*` type scale, so a 720p, 1080p and
 * 4K screen all show the same composition.
 */
export function Stage({ mode = 'screen', uiScale = 1, surface = 'wall', className, children }: StageProps) {
  const fitRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(0.25);

  useEffect(() => {
    if (mode !== 'fit') return undefined;
    const el = fitRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setFitScale(el.clientWidth / STAGE_WIDTH);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  const stageClass = className ? `${styles.stage} ${className}` : styles.stage;
  const stageStyle = {
    '--ui-scale': uiScale,
    ...(mode === 'fit' ? { transform: `scale(${fitScale})` } : {}),
  } as CSSProperties;

  return (
    <div className={mode === 'fit' ? styles.fit : styles.screen} ref={fitRef} data-testid={`stage-${mode}`}>
      <div className={stageClass} style={stageStyle} data-surface={surface}>
        {children}
      </div>
    </div>
  );
}
