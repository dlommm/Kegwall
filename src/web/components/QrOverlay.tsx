import { useMemo } from 'react';
import { qrCodeSvg } from '../lib/qr';

export interface QrOverlayProps {
  /** The absolute URL the QR code should point at (e.g. `location.origin + '/menu'`). */
  url: string;
  className?: string;
}

/**
 * A corner QR code (`config.showQr`) pointing viewers at the menu. The SVG markup comes
 * from `qrCodeSvg` (see `lib/qr.ts` for why `qrcode` over a hand-rolled encoder), memoized
 * per `url` since it's a pure (if slightly non-trivial) computation. An accessible,
 * visually-hidden real `<a>` carries the same link for anyone not scanning with a camera —
 * the decorative `<svg>` itself is `aria-hidden`.
 */
export function QrOverlay({ url, className }: QrOverlayProps) {
  const svgMarkup = useMemo(() => qrCodeSvg(url), [url]);
  const rootClassName = ['qr-overlay', className ?? ''].filter(Boolean).join(' ');

  return (
    <div className={rootClassName} data-testid="qr-overlay">
      {/* eslint-disable-next-line react/no-danger -- qrCodeSvg's output is our own generated markup, not user input */}
      <div aria-hidden="true" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
      <a href={url} className="qr-overlay__link sr-only">
        Open the menu
      </a>
    </div>
  );
}
