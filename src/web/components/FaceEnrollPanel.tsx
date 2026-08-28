import type { FaceEnrollment } from '../lib/useFaceEnrollment';

interface FaceEnrollPanelProps {
  /** Task 8 (face sign-in, Plan B): "note the directory only carries faces when
   * enabled" -- gating the whole row on `faces.enabled` (rather than just the "Add my
   * face" branch) keeps the delete branch from ever rendering off a stale/disabled
   * directory too. */
  enabled: boolean;
  /** The whole enrollment state machine + handlers, from `useFaceEnrollment`. */
  enrollment: FaceEnrollment;
}

/**
 * Task 8 (face sign-in, Plan B): the armed screen's face-enrollment row -- either the
 * idle affordance ("Add my face", or "Face sign-in: enrolled" + delete when a face is
 * already on file) or the multi-state capture panel (`capturing`/`retry`/
 * `save-failed`/`camera-error`/`done`). Pure presentation: every state transition and
 * the camera lifecycle live in `useFaceEnrollment`.
 */
export function FaceEnrollPanel({ enabled, enrollment }: FaceEnrollPanelProps) {
  const {
    enrollState, isEnrolled, enrollVideoRef,
    handleStartEnroll, handleRetryEnroll, handleCancelEnroll, handleDeleteFace,
  } = enrollment;
  if (!enabled) return null;
  return enrollState === 'idle' ? (
    isEnrolled ? (
      <div className="face-enroll__summary" data-testid="face-enroll-summary">
        <span className="face-enroll__status">Face sign-in: enrolled</span>
        <button
          type="button"
          className="tablet-secondary"
          data-testid="face-enroll-delete"
          onClick={handleDeleteFace}
        >
          Remove my face data
        </button>
      </div>
    ) : (
      <button
        type="button"
        className="tablet-secondary"
        data-testid="face-enroll-start"
        onClick={handleStartEnroll}
      >
        Add my face
      </button>
    )
  ) : (
    <div className="face-enroll" data-testid="face-enroll-panel">
      {enrollState === 'capturing' && (
        <>
          <video
            ref={enrollVideoRef}
            className="face-enroll__preview"
            data-testid="face-enroll-preview"
            width={320}
            height={240}
            muted
            playsInline
          />
          <span className="face-enroll__hint">Look at the camera…</span>
          <button
            type="button"
            className="tablet-secondary"
            data-testid="face-enroll-cancel"
            onClick={handleCancelEnroll}
          >
            Cancel
          </button>
        </>
      )}
      {enrollState === 'retry' && (
        <>
          <span className="face-enroll__hint" role="alert">No face found — try again</span>
          <div className="face-enroll__actions">
            <button
              type="button"
              className="tablet-cta"
              data-testid="face-enroll-retry"
              onClick={handleRetryEnroll}
            >
              Try again
            </button>
            <button
              type="button"
              className="tablet-secondary"
              data-testid="face-enroll-cancel"
              onClick={handleCancelEnroll}
            >
              Cancel
            </button>
          </div>
        </>
      )}
      {/* Fix round 1 (F2): distinct from 'retry' above -- at least one
          face WAS detected here, but every `enrollFace` save failed, so
          "No face found" would be dishonest. Reuses the same retry
          affordance/handler ("Try again" -> back to 'capturing'), just
          with copy that says what actually went wrong. */}
      {enrollState === 'save-failed' && (
        <>
          <span className="face-enroll__hint" role="alert" data-testid="face-enroll-save-failed">
            Couldn&rsquo;t save — try again
          </span>
          <div className="face-enroll__actions">
            <button
              type="button"
              className="tablet-cta"
              data-testid="face-enroll-retry"
              onClick={handleRetryEnroll}
            >
              Try again
            </button>
            <button
              type="button"
              className="tablet-secondary"
              data-testid="face-enroll-cancel"
              onClick={handleCancelEnroll}
            >
              Cancel
            </button>
          </div>
        </>
      )}
      {/* Fix round 1 (F3): the camera/model never came up at all -- unlike
          'retry', tapping "Try again" here can't fix a denied permission,
          so a single honest dismissal is the whole affordance (the user
          can always tap "Add my face" again from idle once it's fixed). */}
      {enrollState === 'camera-error' && (
        <>
          <span className="face-enroll__hint" role="alert" data-testid="face-enroll-camera-error">
            Camera unavailable — check the tablet&rsquo;s camera permission
          </span>
          <button
            type="button"
            className="tablet-secondary"
            data-testid="face-enroll-cancel"
            onClick={handleCancelEnroll}
          >
            Close
          </button>
        </>
      )}
      {enrollState === 'done' && (
        <>
          <span className="face-enroll__hint">Face saved — you can sign in by camera next time.</span>
          <button
            type="button"
            className="tablet-secondary"
            data-testid="face-enroll-delete"
            onClick={handleDeleteFace}
          >
            Remove my face data
          </button>
        </>
      )}
    </div>
  );
}
