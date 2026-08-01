/** Cosine similarity in [−1, 1]; 0 when either vector has zero norm (a degenerate
 * embedding must never accidentally "match" everything). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0; let na = 0; let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface EnrolledFace { id: number; drinkerId: number; embedding: number[] }
export interface MatchCandidate { drinkerId: number; score: number }

/** Spec B3: multiple close candidates ⇒ stay silent rather than risk mis-attribution. */
export const AMBIGUITY_MARGIN = 0.05;

export function bestMatch(
  embedding: number[], enrolled: EnrolledFace[], threshold: number,
): MatchCandidate | null {
  let best: MatchCandidate | null = null;
  let bestOther = -Infinity; // best score among drinkers OTHER than the current winner
  const perDrinkerBest = new Map<number, number>();
  for (const f of enrolled) {
    const score = cosineSimilarity(embedding, f.embedding);
    const prev = perDrinkerBest.get(f.drinkerId);
    if (prev === undefined || score > prev) perDrinkerBest.set(f.drinkerId, score);
  }
  for (const [drinkerId, score] of perDrinkerBest) {
    if (!best || score > best.score) best = { drinkerId, score };
  }
  if (!best || best.score < threshold) return null;
  for (const [drinkerId, score] of perDrinkerBest) {
    if (drinkerId !== best.drinkerId && score > bestOther) bestOther = score;
  }
  if (bestOther > best.score - AMBIGUITY_MARGIN) return null;
  return best;
}
