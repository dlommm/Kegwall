import { describe, it, expect, vi } from 'vitest';
import {
  cosineSimilarity, bestMatch, AMBIGUITY_MARGIN, startFacePipeline, type EnrolledFace,
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

describe('startFacePipeline', () => {
  const enrolled = [face(1, 10, [1, 0, 0])];
  function fakeStream() {
    const track = { stop: vi.fn() };
    return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
  }

  it('resolves null when the camera is unavailable', async () => {
    const stop = await startFacePipeline({
      matchEmbedding: async (e) => bestMatch(e, enrolled, 0.6), onCandidate: () => {},
      getUserMedia: () => Promise.reject(new Error('denied')),
      loadHumanFn: async () => ({}),
    });
    expect(stop).toBeNull();
  });

  it('emits one candidate on a match, then self-stops and releases the camera', async () => {
    vi.useFakeTimers();
    const { stream, track } = fakeStream();
    const onCandidate = vi.fn();
    const computeEmbeddingFn = vi.fn().mockResolvedValue([0.99, 0.01, 0]);
    await startFacePipeline({
      matchEmbedding: async (e) => bestMatch(e, enrolled, 0.6), onCandidate, intervalMs: 100,
      getUserMedia: () => Promise.resolve(stream),
      loadHumanFn: async () => ({}), computeEmbeddingFn,
    });
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(300); // more ticks — must NOT re-fire
    expect(onCandidate).toHaveBeenCalledTimes(1);
    expect(onCandidate).toHaveBeenCalledWith(expect.objectContaining({ drinkerId: 10 }));
    expect(track.stop).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('self-stops after noFaceStopMs without a face', async () => {
    vi.useFakeTimers();
    const { stream, track } = fakeStream();
    const computeEmbeddingFn = vi.fn().mockResolvedValue(null); // never a face
    await startFacePipeline({
      matchEmbedding: async (e) => bestMatch(e, enrolled, 0.6), onCandidate: () => {},
      intervalMs: 100, noFaceStopMs: 1_000,
      getUserMedia: () => Promise.resolve(stream),
      loadHumanFn: async () => ({}), computeEmbeddingFn,
    });
    await vi.advanceTimersByTimeAsync(1_200);
    expect(track.stop).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('aborting while the model is still loading stops the camera immediately and never starts', async () => {
    const { stream, track } = fakeStream();
    const controller = new AbortController();
    let resolveHuman: (h: unknown) => void = () => {};
    const loadHumanFn = () => new Promise((resolve) => { resolveHuman = resolve; });
    const onCandidate = vi.fn();
    const pipelinePromise = startFacePipeline({
      matchEmbedding: async (e) => bestMatch(e, enrolled, 0.6), onCandidate,
      getUserMedia: () => Promise.resolve(stream),
      loadHumanFn, signal: controller.signal,
    });
    // Flush the microtasks that resolve getUserMedia and hand the live stream to the
    // pipeline's internal bookkeeping — loadHumanFn is still deliberately pending.
    await Promise.resolve();
    await Promise.resolve();
    expect(track.stop).not.toHaveBeenCalled();

    controller.abort();
    expect(track.stop).toHaveBeenCalled(); // stopped the instant abort fires, not later

    resolveHuman({});
    const stop = await pipelinePromise;
    expect(stop).toBeNull();
    expect(onCandidate).not.toHaveBeenCalled();
  });

  it('an already-aborted signal resolves null without ever touching the camera', async () => {
    const controller = new AbortController();
    controller.abort();
    const getUserMedia = vi.fn();
    const stop = await startFacePipeline({
      matchEmbedding: async (e) => bestMatch(e, enrolled, 0.6), onCandidate: () => {},
      getUserMedia, loadHumanFn: async () => ({}), signal: controller.signal,
    });
    expect(stop).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
