import { describe, it, expect } from 'vitest';
import { cosineSimilarity, bestMatch, type EnrolledFace } from '../../src/server/core/faceMatch.js';

const face = (drinkerId: number, embedding: number[]): EnrolledFace => ({ drinkerId, embedding });

describe('faceMatch (server-side)', () => {
  it('cosineSimilarity: identical → 1, orthogonal → 0, zero-norm → 0', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('returns the best drinker above threshold, null below or for empty enrollment', () => {
    const enrolled = [face(10, [1, 0, 0]), face(20, [0, 1, 0])];
    expect(bestMatch([0.95, 0.05, 0], enrolled, 0.6)).toMatchObject({ drinkerId: 10 });
    expect(bestMatch([1, 0, 0], [face(1, [0, 1, 0])], 0.6)).toBeNull();
    expect(bestMatch([1, 0, 0], [], 0.6)).toBeNull();
  });

  it('stays silent when the top two drinkers are within the ambiguity margin', () => {
    const enrolled = [face(10, [1, 0.1, 0]), face(20, [1, 0.12, 0])];
    expect(bestMatch([1, 0.115, 0], enrolled, 0.6)).toBeNull();
  });
});
