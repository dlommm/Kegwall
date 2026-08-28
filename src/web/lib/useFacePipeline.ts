import {
  useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction,
} from 'react';
import { startFacePipeline, type MatchCandidate } from './faceRecognition';
import { matchFace, type FaceDirectory, type PublicPourer } from './api';

/** A pipeline match resolved against the loaded pourers list -- structurally the
 * tablet's `ActivePourer` shape, so confirming one runs the exact same arm flow a
 * manual avatar tap uses. */
export interface FaceMatchPourer {
  id: number;
  name: string;
  color: string | null;
}

export interface UseFacePipelineOptions {
  /** TabletPage's live screen ref -- read from event-handler closures (camera motion,
   * pointer taps) that don't otherwise see a fresh render. Only `kind` matters here:
   * the pipeline may only run (and a candidate may only surface) on the grid screen. */
  screenRef: { readonly current: { kind: string } };
  /** The current screen kind as reactive state -- the teardown guard effect below is a
   * plain effect that re-runs on a fresh render, so it reads this, not the ref. */
  screenKind: string;
  /** The enrolled-faces directory (TabletPage refetches it on WS `faces_changed`). */
  faces: FaceDirectory;
  /** The loaded pourers list a candidate's drinkerId is resolved against. */
  pourers: PublicPourer[];
}

export interface FacePipeline {
  /** The one-tap confirm sheet's pourer, or null when no sheet is showing. */
  faceConfirm: FaceMatchPourer | null;
  /** Exposed for the sheet's own "Yes"/"Not me" actions -- both just clear it. */
  setFaceConfirm: Dispatch<SetStateAction<FaceMatchPourer | null>>;
  /** The pipeline's single entry point -- see its doc below. */
  maybeStartFacePipeline: () => void;
}

/**
 * Task 7 (face sign-in, Plan B): the browser face-match pipeline's ref choreography,
 * extracted from TabletPage -- the "at most one pipeline at a time" guard, candidate
 * resolution into the one-tap confirm sheet, and every teardown path (unmount,
 * screen-leaves-grid, directory-goes-disabled). At most one pipeline ever runs at a
 * time (a ref guard, not state — starting one must never wait on a render).
 */
export function useFacePipeline(
  {
    screenRef, screenKind, faces, pourers,
  }: UseFacePipelineOptions,
): FacePipeline {
  // `facesRef`/`pourersRef` mirror TabletPage's `screenRef` -- read from event-handler
  // closures (camera motion, pointer taps) that don't otherwise see a fresh render.
  const facesRef = useRef<FaceDirectory>(faces);
  facesRef.current = faces;
  const pourersRef = useRef<PublicPourer[]>(pourers);
  pourersRef.current = pourers;

  // Task 7 (face sign-in, Plan B): the one-tap confirm sheet a pipeline match opens.
  const [faceConfirm, setFaceConfirm] = useState<FaceMatchPourer | null>(null);

  // "At most one pipeline at a time" ref guard: set synchronously the instant a start
  // is attempted -- before `startFacePipeline`'s own async camera/model-load work even
  // begins -- so a second motion/tap landing before that promise resolves can never
  // slip through and start an overlapping session. `facePipelineControllerRef` is this
  // attempt's cancellation seam (Task 6's `signal`); `facePipelineStopRef` is the
  // disposer once the pipeline actually starts ticking. Both are read by the
  // unmount-cleanup effect below.
  const facePipelineActiveRef = useRef(false);
  const facePipelineControllerRef = useRef<AbortController | null>(null);
  const facePipelineStopRef = useRef<(() => void) | null>(null);

  /** A pipeline match: resolve it against the already-loaded pourers list (an
   * unknown/stale drinkerId -- the directory can lag a deletion -- is ignored
   * silently, no sheet) and open the one-tap confirm sheet. The pipeline itself always
   * self-stops right after firing this (faceRecognition.ts's `dispose()` inside
   * `startFacePipeline`'s tick handler), so clearing the ref guard here is exactly what
   * lets the NEXT motion/tap start a fresh run -- "Not me" never needs to touch these
   * refs itself, since by the time it's clickable this has already run.
   *
   * Fix round 1 (mis-arm guard): a pipeline started on the grid screen can still be
   * running when someone arms manually in the meantime (hand-tap an avatar, or
   * signup) -- `startFacePipeline`'s own promise chain has no way to know the screen
   * moved on. Without this check, a late `onCandidate` would pop the confirm sheet
   * over whatever screen is now showing, and "Yes" would call `armTablet` with a
   * *different* drinkerId than whoever's actually armed -- core/tabletArm.ts silently
   * replaces the armed slot, so the next pour would attribute to the wrong person.
   * Reading `screenRef.current` here (not a value closed over when the pipeline
   * started) catches every screen the tablet could have moved to since then. The
   * pipeline itself isn't stopped by this -- it already self-stopped by firing
   * `onCandidate` in the first place -- so no extra cleanup is needed here. */
  const handleFaceCandidate = useCallback(({ drinkerId }: MatchCandidate) => {
    facePipelineActiveRef.current = false;
    facePipelineControllerRef.current = null;
    facePipelineStopRef.current = null;
    if (screenRef.current.kind !== 'grid') return;
    const pourer = pourersRef.current.find((p) => p.id === drinkerId);
    if (!pourer) return;
    setFaceConfirm({ id: pourer.id, name: pourer.displayName, color: pourer.avatarColor });
  }, [screenRef]);

  /** Starts the face pipeline (Task 6) when the directory is enabled/non-empty and the
   * grid screen is showing -- called from TabletPage's two trigger sites: camera
   * motion (the pipeline's primary trigger) and, when the wall has no camera-motion
   * input at all, a pointer-tap fallback. Reads `faces`/`screen`/`pourers` via refs
   * since it's invoked from event-handler closures that don't otherwise see a fresh
   * render. A fresh `AbortController` per attempt lets the unmount-cleanup effect
   * below close the live-camera-during-model-load window (see faceRecognition.ts's
   * `signal` doc) even if this specific attempt hasn't resolved yet. */
  const maybeStartFacePipeline = useCallback(() => {
    if (facePipelineActiveRef.current) return;
    const directory = facesRef.current;
    if (!directory.enabled) return;
    if (screenRef.current.kind !== 'grid') return;

    facePipelineActiveRef.current = true;
    const controller = new AbortController();
    facePipelineControllerRef.current = controller;

    startFacePipeline({
      // Matching is SERVER-SIDE now — the probe embedding is posted to /api/public/faces/
      // match and the corpus never reaches this browser. Returns null on no match / error.
      matchEmbedding: (embedding) => matchFace(embedding).then((r) => (r.ok ? r.data.match : null)),
      onCandidate: handleFaceCandidate,
      signal: controller.signal,
    }).then((disposer) => {
      if (facePipelineControllerRef.current === controller) facePipelineControllerRef.current = null;
      if (!disposer) {
        facePipelineActiveRef.current = false;
        return;
      }
      facePipelineStopRef.current = disposer;
    });
  }, [handleFaceCandidate, screenRef]);

  // Belt and braces (Task 7): on unmount, abort whichever attempt's controller is still
  // live -- stops a camera that's mid getUserMedia/model-load immediately, per
  // faceRecognition.ts's `signal` contract, rather than waiting for that promise to
  // settle -- AND call the disposer if one had already resolved by then. Both are
  // idempotent (an aborted `startFacePipeline` resolves without ever setting
  // `facePipelineStopRef`; a disposer's own `dispose()` is safe to call more than
  // once), so running both unconditionally here is safe regardless of which stage the
  // pipeline was in when the component unmounted.
  useEffect(() => () => {
    facePipelineControllerRef.current?.abort();
    facePipelineStopRef.current?.();
  }, []);

  /** Fix round 2 (F1): the pipeline must not keep the camera + `human.detect` loop
   * alive once it's no longer allowed to run. Two scenarios: an unenrolled drinker (or
   * anyone else) lingers in frame with no match while the screen moves on -- a manual
   * avatar tap or signup arms/leaves 'grid' out from under a still-running pipeline --
   * or an admin flips face sign-in off mid-run (`faces_changed` refetches an
   * empty/disabled directory), after which `getEnrolled()` can never match again but
   * nothing was otherwise telling the pipeline to stop. Mirrors the unmount-cleanup
   * effect directly above -- abort whichever controller is still live (per
   * faceRecognition.ts's `signal` contract, this closes a mid getUserMedia/model-load
   * attempt immediately rather than waiting for it to settle) AND call the disposer if
   * one had already resolved -- plus clears `facePipelineActiveRef` so a LATER return to
   * an enabled grid starts a genuinely fresh attempt instead of finding the "at most
   * one" ref guard still stuck on. All three teardown calls are idempotent (same
   * reasoning as that effect: an aborted `startFacePipeline` resolves without setting
   * `facePipelineStopRef`, and a disposer's own `dispose()` tolerates repeat calls), so
   * running them unconditionally whenever the guard condition is false -- not just on
   * the transition into it -- is safe, including redundantly alongside
   * `handleFaceCandidate`'s own per-candidate self-stop. Reads the reactive
   * `screenKind`/`faces.enabled` values (not the refs those event-handler closures
   * use) since this is a plain effect that already re-runs on a fresh render whenever
   * either changes -- same idiom as `useFaceEnrollment`'s screen-change reset effect.
   * Intentionally a no-op while `screenKind === 'grid' && faces.enabled`, so it never
   * fights a pipeline that's allowed to keep running. */
  useEffect(() => {
    if (screenKind === 'grid' && faces.enabled) return;
    facePipelineActiveRef.current = false;
    facePipelineControllerRef.current?.abort();
    facePipelineControllerRef.current = null;
    facePipelineStopRef.current?.();
    facePipelineStopRef.current = null;
  }, [screenKind, faces.enabled]);

  return { faceConfirm, setFaceConfirm, maybeStartFacePipeline };
}
