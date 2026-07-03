// Per-device stream cache for `x-zab.capture` ACQUIRE mode.
//
// Why this exists: a scene switch remounts the WHOLE render tree
// (`AnimatePresence` keyed on the scene id in app.tsx / crossfade.tsx), so every
// `Capture` node unmounts and a fresh one mounts. Without sharing, each switch
// stops the old node's tracks (RC11) and re-acquires the same physical device in
// the new node. A real USB webcam reopens near-instantly, but a synthetic
// DirectShow filter (OBS Virtual Camera) renegotiates slowly → a visible blink
// on every switch, because — by design (ADR 007 Prism) — every scene references
// the SAME shared vcam device.
//
// The fix mirrors the editor's `use-live-source.ts`: a ref-counted cache keyed by
// the resolved PHYSICAL device. Two `Capture` nodes on the same device share one
// `getUserMedia`; tracks stop (RC11) only when the LAST consumer releases. During
// a crossfade both the exiting and entering scenes are mounted at once
// (`AnimatePresence mode="sync"`), so the ref-count never reaches 0 across a
// switch and the device is never renegotiated — no blink.
//
// Cache key stability: the key is the resolved `deviceId` / `captureSourceId`, not
// the raw logical `deviceRef`. Physical ids are salted per origin/partition (see
// capture.tsx §A1.3), but the salt is constant WITHIN one runtime origin, so the
// resolved id is stable across scene switches inside a single mount/session — the
// exact scope over which sharing must hold. Keying on the physical id also
// correctly de-dupes two distinct `deviceRef`s that resolve to the same device.

import type { ResolveCaptureDevice } from "./capture";

interface CacheEntry {
  promise: Promise<MediaStream>;
  stream: MediaStream | null;
  refs: number;
}

const cache = new Map<string, CacheEntry>();

/** Outcome of a claim: either a shared stream promise (with the key to release
 *  later) or PLACEHOLDER — the unknown-kind / declared-but-unresolved-ref path
 *  that acquires nothing, exactly as the old inline `acquireStream` returning
 *  `null` did. A PLACEHOLDER claim holds NO ref (nothing to release). */
export type CaptureClaim =
  | { kind: "stream"; key: string; promise: Promise<MediaStream> }
  | { kind: "placeholder" };

/** Resolve the device, then claim a shared stream for it (incrementing the
 *  ref-count), or return PLACEHOLDER. Awaits the resolver first — physical ids
 *  are salted per origin/partition, so the host may re-resolve a portable key
 *  (label) against THIS context (capture.tsx §A1.3). A throw from the underlying
 *  `getUserMedia` surfaces via the returned promise (caller → PLACEHOLDER). */
export async function claimCaptureStream(
  sourceKind: string,
  deviceRef: string,
  resolveCaptureDevice: ResolveCaptureDevice | undefined,
): Promise<CaptureClaim> {
  const md = navigator.mediaDevices;
  const resolved = (await resolveCaptureDevice?.(deviceRef, sourceKind)) ?? null;
  const deviceId = resolved?.deviceId;
  const captureSourceId = resolved?.captureSourceId;
  const declaredRef = deviceRef.length > 0;

  // Compute a stable physical key + a lazy acquisition thunk, or bail to
  // PLACEHOLDER for the same reasons the inline switch used to return `null`.
  let physicalId: string;
  let acquire: () => Promise<MediaStream>;
  switch (sourceKind) {
    case "media.webcam":
    case "media.mic":
    case "media.app_audio": {
      // §A1.3 (amended) — NO default-device fallback for a DECLARED deviceRef
      // that did not resolve. Acquiring the host default here is the silent
      // "automatic allocation" of the WRONG camera. → PLACEHOLDER. The bare
      // default constraint stays ONLY when no deviceRef is declared at all.
      if (declaredRef && (typeof deviceId !== "string" || deviceId.length === 0)) {
        return { kind: "placeholder" };
      }
      const channel = sourceKind === "media.webcam" ? "video" : "audio";
      physicalId = typeof deviceId === "string" && deviceId.length > 0 ? deviceId : "default";
      acquire = () => md.getUserMedia({ [channel]: deviceConstraint(deviceId) });
      break;
    }
    case "media.screen":
    case "media.window": {
      // DIRECT capture of the picked desktopCapturer surface (no system picker)
      // via Electron's legacy `chromeMediaSource:desktop` + resolved id.
      if (typeof captureSourceId === "string" && captureSourceId.length > 0) {
        physicalId = captureSourceId;
        acquire = () =>
          md.getUserMedia({
            video: {
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: captureSourceId,
              },
            } as unknown as MediaTrackConstraints,
          });
        break;
      }
      // A declared surface ref that didn't resolve → PLACEHOLDER, never a
      // default picker. The picker stays only when no ref is declared.
      if (declaredRef) return { kind: "placeholder" };
      physicalId = "display";
      acquire = () => md.getDisplayMedia({ video: true });
      break;
    }
    default:
      return { kind: "placeholder" };
  }

  const key = `${sourceKind}:${physicalId}`;
  const existing = cache.get(key);
  if (existing) {
    existing.refs += 1;
    return { kind: "stream", key, promise: existing.promise };
  }
  const promise = acquire();
  const entry: CacheEntry = { promise, stream: null, refs: 1 };
  cache.set(key, entry);
  promise
    .then((s) => {
      entry.stream = s;
    })
    .catch(() => {
      // Acquisition failed — evict so a later mount retries instead of sharing a
      // rejected promise. Consumers of this promise all fall back to PLACEHOLDER.
      cache.delete(key);
    });
  return { kind: "stream", key, promise };
}

/** Drop one consumer's claim. Stops every track (RC11 — kill the device light)
 *  ONLY when the last consumer releases. A no-op for an already-evicted key
 *  (e.g. an acquisition that rejected and self-evicted). */
export function releaseCaptureStream(key: string): void {
  const entry = cache.get(key);
  if (entry === undefined) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  cache.delete(key);
  if (entry.stream !== null) stopStream(entry.stream);
}

/** A `getUserMedia` track constraint. A resolved deviceId is pinned with
 *  `exact`, NOT a bare (ideal) deviceId: an *ideal* constraint SILENTLY falls
 *  back to the host default camera when the requested device can't start (e.g.
 *  an INACTIVE virtual cam enumerated but producing no stream). `exact` yields
 *  the requested device (its placeholder frame if idle), or an
 *  OverconstrainedError the caller catches into PLACEHOLDER — never the wrong
 *  cam. No deviceId → `true` (host default) applies ONLY when no deviceRef was
 *  declared. */
function deviceConstraint(deviceId: string | undefined): MediaTrackConstraints | boolean {
  return typeof deviceId === "string" && deviceId.length > 0
    ? { deviceId: { exact: deviceId } }
    : true;
}

/** Stop every track of a stream (RC11 — release the camera/mic, kill the light). */
function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** Test-only: drop all cached entries WITHOUT stopping tracks. Lets a test file
 *  start from a clean ref-count without leaking state between cases. */
export function __resetCaptureStreamCache(): void {
  cache.clear();
}
