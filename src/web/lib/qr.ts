import QRCode from 'qrcode';

/**
 * Renders `text` as an SVG QR code string, synchronously.
 *
 * Why `qrcode` and not a bespoke encoder: QR encoding (Reed-Solomon error correction,
 * version/mask selection, format/timing patterns) is genuinely intricate to get right,
 * and a hand-rolled encoder is exactly the kind of thing that "works" until a phone
 * camera disagrees. `qrcode` is a small (no runtime deps of its own beyond `dijkstrajs`
 * for mask-pattern selection), actively maintained, MIT-licensed package with an SVG
 * renderer that needs neither a `<canvas>` nor Node's `canvas` native module — exactly
 * what a corner overlay on a TV page (and a jsdom test) needs.
 *
 * Why this wrapper instead of calling `QRCode.toString` directly: its public signature
 * is callback/Promise-based for the general case, but inspecting its source
 * (`qrcode/lib/browser.js` and `lib/server.js`, both used depending on bundler target)
 * shows that supplying a callback as the third argument takes a fully synchronous code
 * path — `QRCode.create` (pure computation) followed immediately by the SVG renderer,
 * with the callback invoked in the same tick, no `Promise`/microtask involved. This
 * wrapper captures that callback's result so QR generation reads as the plain,
 * synchronous, render time-safe computation it actually is (a `useMemo` away from a
 * component), avoiding an async loading-flash for something this cheap and pure.
 */
export function qrCodeSvg(text: string, options: { margin?: number } = {}): string {
  let svg: string | undefined;
  let error: Error | null | undefined;
  QRCode.toString(text, { type: 'svg', margin: options.margin ?? 1 }, (err, result) => {
    error = err;
    svg = result;
  });
  if (error) throw error;
  return svg ?? '';
}
