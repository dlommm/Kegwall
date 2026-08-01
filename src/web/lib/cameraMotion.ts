const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 120;
/** A pixel's luma is considered "moved" once its 0-255 value shifts by more than this. */
const LUMA_DELTA_THRESHOLD = 25;

export interface CameraMotionOptions {
  /** Called whenever a captured frame's changed-pixel fraction exceeds `threshold`. */
  onMotion: () => void;
  /** Ms between captured frames. */
  intervalMs?: number;
  /** Fraction (0-1) of pixels that must cross the luma delta to count as motion. */
  threshold?: number;
  /** Test seam — defaults to `navigator.mediaDevices.getUserMedia`. */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

/**
 * Fraction of pixels whose luma (perceived brightness) changed by more than
 * `LUMA_DELTA_THRESHOLD` between two same-sized RGBA byte buffers (one pixel per 4
 * bytes: R, G, B, A). Pure and allocation-light so it can run every `intervalMs` tick
 * without becoming its own performance problem. Exported for unit tests — it's the one
 * piece of `startCameraMotion` testable without a real camera/canvas.
 */
export function diffFraction(prev: Uint8ClampedArray, curr: Uint8ClampedArray): number {
  const pixelCount = prev.length / 4;
  if (pixelCount === 0) return 0;
  let changed = 0;
  for (let i = 0; i < prev.length; i += 4) {
    const lumaPrev = 0.299 * prev[i]! + 0.587 * prev[i + 1]! + 0.114 * prev[i + 2]!;
    const lumaCurr = 0.299 * curr[i]! + 0.587 * curr[i + 1]! + 0.114 * curr[i + 2]!;
    if (Math.abs(lumaCurr - lumaPrev) > LUMA_DELTA_THRESHOLD) changed += 1;
  }
  return changed / pixelCount;
}

/**
 * Browser camera motion detector (Task 11, "presence & display power" spec Part B):
 * grabs a low-res (160x120) camera feed, samples it into an offscreen canvas every
 * `intervalMs`, and diffs each frame's luma bytes against the previous one via
 * `diffFraction`. No ML, no frame storage beyond the last one — plain frame
 * differencing, the same "keep it boring" spirit as the pointer-tap presence wake
 * (Task 10). Callers (TabletPage) wire `onMotion` to `useDisplayPower`'s
 * `wake('camera')`, gated behind the wall's `displayPower.cameraMotion` config flag so
 * a camera is never touched unless an admin opted in.
 *
 * Resolves `null` — never rejects — when there's no camera, permission is denied, or
 * the canvas 2D context can't be acquired; callers treat `null` as "feature
 * unavailable" and simply don't start the detector, same as a missing `matchMedia`
 * elsewhere in this codebase. `getUserMedia` is awaited before any canvas/video
 * element is created, so the unavailable path never touches the DOM beyond that.
 */
export async function startCameraMotion(
  opts: CameraMotionOptions,
): Promise<(() => void) | null> {
  const {
    onMotion,
    intervalMs = 500,
    threshold = 0.05,
    getUserMedia = (constraints: MediaStreamConstraints) => (
      navigator.mediaDevices.getUserMedia(constraints)
    ),
  } = opts;

  let stream: MediaStream;
  try {
    stream = await getUserMedia({
      video: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
      audio: false,
    });
  } catch {
    return null;
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  const canvas = document.createElement('canvas');
  canvas.width = FRAME_WIDTH;
  canvas.height = FRAME_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    stream.getTracks().forEach((track) => track.stop());
    return null;
  }

  // Autoplay a muted, playsInline stream never needs user gesture approval; failures
  // here (e.g. a track that ends immediately) just mean frames stay blank/unchanged,
  // which is harmless — no motion gets reported, same as a quiet room.
  void video.play().catch(() => {});

  let previousFrame: Uint8ClampedArray | null = null;
  let stopped = false;

  const captureFrame = () => {
    if (stopped || document.visibilityState === 'hidden') return;
    ctx.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    const currentFrame = ctx.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT).data;
    if (previousFrame && diffFraction(previousFrame, currentFrame) > threshold) onMotion();
    previousFrame = currentFrame;
  };

  const intervalId = setInterval(captureFrame, intervalMs);

  return () => {
    stopped = true;
    clearInterval(intervalId);
    stream.getTracks().forEach((track) => track.stop());
  };
}
