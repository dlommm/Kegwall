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

const VIDEO_WIDTH = 320;
const VIDEO_HEIGHT = 240;

/** Module-level singleton so every pipeline run (and every embedding call) shares one
 * loaded model instead of re-downloading weights. `@vladmandic/human` is dynamically
 * imported here — not at module top-level — so it's code-split out of the main bundle
 * and only fetched once a face-sign-in flow actually starts. `modelBasePath: '/models/'`
 * points at this repo's self-hosted assets (Task 4); the library's own default points at
 * a CDN, which the "no CDN calls" constraint rules out. Everything except face
 * detect+mesh+description is disabled — this pipeline only ever needs an embedding. */
let humanPromise: Promise<unknown> | null = null;

export function loadHuman(): Promise<unknown> {
  if (!humanPromise) {
    humanPromise = import('@vladmandic/human').then((m) => {
      const human = new m.default({
        modelBasePath: '/models/',
        filter: { enabled: false },
        face: {
          enabled: true,
          detector: { maxDetected: 1, rotation: false },
          mesh: { enabled: true },
          iris: { enabled: false },
          emotion: { enabled: false },
          antispoof: { enabled: false },
          liveness: { enabled: false },
          description: { enabled: true },
        },
        body: { enabled: false },
        hand: { enabled: false },
        object: { enabled: false },
        gesture: { enabled: false },
        warmup: 'none',
      });
      return human;
    });
  }
  return humanPromise;
}

/** Runs one detect pass on `video` and returns the first detected face's embedding, or
 * `null` when no face is present. `human` is untyped (`unknown`) because callers only
 * ever obtain it from `loadHuman`/`loadHumanFn` — this is the one place that trusts its
 * shape. */
export async function computeEmbedding(
  human: unknown, video: HTMLVideoElement,
): Promise<number[] | null> {
  const res = await (human as any).detect(video);
  const emb = res?.face?.[0]?.embedding;
  return Array.isArray(emb) && emb.length ? Array.from(emb) : null;
}

export interface FacePipelineOptions {
  getEnrolled: () => EnrolledFace[];
  threshold: number;
  onCandidate: (c: MatchCandidate) => void;
  /** Ms between detect passes. */
  intervalMs?: number;
  /** Self-stop after this long without a single detected face. */
  noFaceStopMs?: number;
  /** Aborting before the pipeline finishes starting (camera acquisition and model load,
   * run concurrently) stops any camera stream that already came up, skips starting the
   * interval, and resolves `null` — the same "feature unavailable" contract a denied/
   * missing camera already has, since a caller that aborted mid-start no longer wants
   * the disposer it would otherwise get. */
  signal?: AbortSignal;
  /** Test seam — defaults to `navigator.mediaDevices.getUserMedia`. */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** Test seam — defaults to `loadHuman`. */
  loadHumanFn?: () => Promise<unknown>;
  /** Test seam — defaults to `computeEmbedding`. */
  computeEmbeddingFn?: typeof computeEmbedding;
}

/**
 * Browser face sign-in pipeline (Plan B, motion-gated by callers the same way
 * `cameraMotion.ts`'s detector is): grabs a 320x240 camera feed, runs `@vladmandic/human`
 * detect+embed on it every `intervalMs`, and matches each embedding against
 * `getEnrolled()` via `bestMatch`. The first match above `threshold` fires `onCandidate`
 * exactly once and then self-stops — same disposer path a caller-initiated stop would
 * run — so a session never emits a second, possibly-different candidate. A pipeline that
 * never sees a face at all self-stops after `noFaceStopMs` so an errant "start" never
 * pins the camera open indefinitely.
 *
 * Resolves `null` — never rejects — when there's no camera or permission is denied,
 * mirroring `startCameraMotion`'s "feature simply isn't available" contract. Camera
 * acquisition and model load are independent, so they run concurrently (`Promise.all`)
 * rather than sequentially: the window during which a live camera stream exists but no
 * disposer has been handed back yet is `max(getUserMedia, loadHumanFn)`, not their sum.
 * `opts.signal` covers cancelling that window — an `abort` while either is still pending
 * stops the stream's tracks the instant it fires (via an `abort` listener, not only once
 * the pending await returns), skips starting the interval, and resolves `null`; an
 * already-aborted `signal` short-circuits before `getUserMedia` is even called. `stopped`
 * separately guards the one race this covers *after* a normal start: an in-flight
 * `computeEmbeddingFn` call resolving after the disposer already ran (via `noFaceStopMs`,
 * a match, `signal` abort, or a caller's own stop) — that tick's result is dropped
 * instead of touching state or firing a second `onCandidate`.
 */
export async function startFacePipeline(
  opts: FacePipelineOptions,
): Promise<(() => void) | null> {
  const {
    getEnrolled,
    threshold,
    onCandidate,
    intervalMs = 750,
    noFaceStopMs = 30_000,
    getUserMedia = (constraints: MediaStreamConstraints) => (
      navigator.mediaDevices.getUserMedia(constraints)
    ),
    loadHumanFn = loadHuman,
    computeEmbeddingFn = computeEmbedding,
    signal,
  } = opts;

  if (signal?.aborted) return null;

  // `liveStream` is populated the instant getUserMedia resolves — independent of
  // whether loadHumanFn has finished — so an abort that fires while the model is still
  // loading stops tracks right away via the listener below, rather than waiting for
  // both awaits to settle.
  let liveStream: MediaStream | undefined;
  const stopLiveStream = () => liveStream?.getTracks().forEach((track) => track.stop());
  signal?.addEventListener('abort', stopLiveStream, { once: true });

  const getUserMediaPromise = getUserMedia({
    video: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
    audio: false,
  }).then((s) => {
    liveStream = s;
    if (signal?.aborted) s.getTracks().forEach((track) => track.stop());
    return s;
  });
  const loadHumanPromise = loadHumanFn().then((h) => {
    if (signal?.aborted) stopLiveStream();
    return h;
  });

  let stream: MediaStream;
  let human: unknown;
  try {
    [stream, human] = await Promise.all([getUserMediaPromise, loadHumanPromise]);
  } catch {
    signal?.removeEventListener('abort', stopLiveStream);
    // Whichever of the two rejected, don't leave the other's eventual settlement as a
    // dangling unhandled rejection, and release any stream that did come up.
    getUserMediaPromise.catch(() => {});
    loadHumanPromise.catch(() => {});
    stopLiveStream();
    return null;
  }

  signal?.removeEventListener('abort', stopLiveStream);
  if (signal?.aborted) {
    stream.getTracks().forEach((track) => track.stop());
    return null;
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  // Don't await — jsdom's play() stub never resolves in a test environment (and under
  // fake timers doesn't even return a Promise), and a real rejection (e.g. a track that
  // ends immediately) just means frames stay blank, same as cameraMotion.ts's identical
  // fire-and-forget play().
  video.play()?.catch(() => {});

  let stopped = false;
  let sinceLastFaceMs = 0;

  const dispose = () => {
    stopped = true;
    clearInterval(intervalId);
    stream.getTracks().forEach((track) => track.stop());
  };

  const tick = () => {
    if (stopped || document.visibilityState === 'hidden') return;
    void computeEmbeddingFn(human, video).then((embedding) => {
      if (stopped) return; // disposed while this detect pass was in flight
      if (!embedding) {
        sinceLastFaceMs += intervalMs;
        if (sinceLastFaceMs >= noFaceStopMs) dispose();
        return;
      }
      sinceLastFaceMs = 0;
      const candidate = bestMatch(embedding, getEnrolled(), threshold);
      if (candidate) {
        onCandidate(candidate); // at most once — dispose() below stops further ticks
        dispose();
      }
    });
  };

  const intervalId = setInterval(tick, intervalMs);

  return dispose;
}
