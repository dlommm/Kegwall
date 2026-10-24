/** Marks per group: four strokes and the fifth struck through them. */
const GROUP = 5;
/** Past this many marks the tally stops drawing and the number alone carries it. */
const MAX_MARKS = 60;

/**
 * Bar-tab tally marks (Kegwall 2.1): one stroke per pour, struck through in fives. Drawn in
 * `currentColor`; decorative, so the count must also be said in text beside it.
 */
export function Tally({ count, className, height = 28 }: { count: number; className?: string; height?: number }) {
  const n = Math.max(0, Math.min(MAX_MARKS, Math.round(count)));
  const groups = Math.ceil(n / GROUP);
  if (groups === 0) return null;
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    const g = Math.floor(i / GROUP);
    const k = i % GROUP;
    const x0 = g * 30 + 4;
    lines.push(k < GROUP - 1
      ? <line key={i} x1={x0 + k * 5} y1={4} x2={x0 + k * 5 + 1} y2={26} />
      : <line key={i} x1={x0 - 3} y1={22} x2={x0 + 19} y2={7} />);
  }
  return (
    <svg
      className={className}
      viewBox={`0 0 ${groups * 30} 30`}
      height={height}
      width={(groups * 30 * height) / 30}
      aria-hidden="true"
      data-testid="tally"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      fill="none"
    >
      {lines}
    </svg>
  );
}
