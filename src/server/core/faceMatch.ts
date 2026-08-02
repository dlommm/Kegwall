// ---------------------------------------------------------------------------
// Server-side face matching. Face embeddings are irrevocable biometric data — they must
// never leave the server as raw vectors (a leaked corpus enables permanent cross-system
// re-identification and template-inversion). So the tablet computes a probe embedding
// on-device and POSTs it here; the server compares it against the enrolled corpus and
// returns only { drinkerId, score } — the corpus itself is never serialized to any client.
// This is the exact cosine/ambiguity logic the browser used to run locally (kept in sync
// with src/web/lib/faceRecognition.ts's cosineSimilarity/bestMatch).
// ---------------------------------------------------------------------------

/** Cosine similarity in [−1, 1]; 0 when either vector has zero norm (a degenerate embedding
 * must never accidentally "match" everything). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0; let na = 0; let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface EnrolledFace { drinkerId: number; embedding: number[] }
export interface MatchCandidate { drinkerId: number; score: number }

/** Multiple close candidates ⇒ stay silent rather than risk mis-attribution (spec B3). */
export const AMBIGUITY_MARGIN = 0.05;

/** Best per-drinker match above `threshold`, or null when nothing clears the bar or the top
 * two drinkers are within `AMBIGUITY_MARGIN` of each other. */
export function bestMatch(
  embedding: number[], enrolled: EnrolledFace[], threshold: number,
): MatchCandidate | null {
  const perDrinkerBest = new Map<number, number>();
  for (const f of enrolled) {
    const score = cosineSimilarity(embedding, f.embedding);
    const prev = perDrinkerBest.get(f.drinkerId);
    if (prev === undefined || score > prev) perDrinkerBest.set(f.drinkerId, score);
  }
  let best: MatchCandidate | null = null;
  for (const [drinkerId, score] of perDrinkerBest) {
    if (!best || score > best.score) best = { drinkerId, score };
  }
  if (!best || best.score < threshold) return null;
  let bestOther = -Infinity;
  for (const [drinkerId, score] of perDrinkerBest) {
    if (drinkerId !== best.drinkerId && score > bestOther) bestOther = score;
  }
  if (bestOther > best.score - AMBIGUITY_MARGIN) return null;
  return best;
}
