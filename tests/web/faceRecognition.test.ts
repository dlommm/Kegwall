import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity, bestMatch, AMBIGUITY_MARGIN, type EnrolledFace,
} from '../../src/web/lib/faceRecognition';

describe('cosineSimilarity', () => {
  it('is 1 for identical, 0 for orthogonal, 0 for zero vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

const face = (id: number, drinkerId: number, embedding: number[]): EnrolledFace => ({ id, drinkerId, embedding });

describe('bestMatch', () => {
  it('returns the best drinker above threshold', () => {
    const enrolled = [face(1, 10, [1, 0, 0]), face(2, 20, [0, 1, 0])];
    expect(bestMatch([0.95, 0.05, 0], enrolled, 0.6)).toMatchObject({ drinkerId: 10 });
  });

  it('returns null below threshold and for empty enrollment', () => {
    expect(bestMatch([1, 0, 0], [face(1, 10, [0, 1, 0])], 0.6)).toBeNull();
    expect(bestMatch([1, 0, 0], [], 0.6)).toBeNull();
  });

  it('stays silent when the runner-up drinker is within the ambiguity margin', () => {
    const enrolled = [face(1, 10, [1, 0.10, 0]), face(2, 20, [1, 0.13, 0])];
    expect(bestMatch([1, 0.115, 0], enrolled, 0.6)).toBeNull();
  });

  it('is NOT ambiguous when the close runner-up is the SAME drinker', () => {
    const enrolled = [face(1, 10, [1, 0.10, 0]), face(2, 10, [1, 0.13, 0])];
    expect(bestMatch([1, 0.115, 0], enrolled, 0.6)).toMatchObject({ drinkerId: 10 });
  });
});
