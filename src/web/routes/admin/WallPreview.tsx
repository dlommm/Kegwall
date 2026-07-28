export interface WallPreviewProps {
  slug: string;
  /** Bump this to force the iframe to remount (a fresh navigation, not just a repaint) —
   * the wall editor's save flow does this after every successful PATCH so the preview
   * always reflects what was just saved, per the Task 7 brief ("reload on save"). */
  reloadKey?: number | string;
  testId?: string;
  className?: string;
}

/**
 * A live `/wall/:slug` embed — used both for the walls list's read-only per-row preview
 * (everyone, including a viewer) and inside `WallEditor`'s side-by-side live preview
 * panel. Deliberately a plain, unstyled-beyond-sizing iframe: the wall page itself
 * already renders its own theme/fullscreen chrome, so this just frames it.
 */
export function WallPreview({
  slug, reloadKey, testId = 'wall-preview-frame', className,
}: WallPreviewProps) {
  return (
    <iframe
      key={reloadKey}
      title={`Live preview of the "${slug}" wall`}
      src={`/wall/${slug}`}
      data-testid={testId}
      className={className ? `wall-preview__frame ${className}` : 'wall-preview__frame'}
    />
  );
}
