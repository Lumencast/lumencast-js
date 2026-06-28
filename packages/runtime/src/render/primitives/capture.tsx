import { useEffect, useRef, useState } from "react";
import type { PrimitiveProps } from "./index";
import { useOptionalLumencastRuntime } from "../../overlay/runtime-context";

/** `x-zab.capture` — context-aware capture primitive (Zab vendor primitive,
 *  RFC-0001 / ADR 004 §Amendment 1).
 *
 *  The primitive reserves a box of the declared geometry so downstream layout
 *  (siblings, masks, stacks, grids) is unaffected — exactly as an `image` of
 *  the same geometry, in BOTH modes below. It picks a mode by **capability
 *  detection at mount** (feature detection, not an env flag) :
 *
 *   - **ACQUIRE** (capable host, e.g. the Electron preview webview with
 *     auto-granted media permissions) : it acquires a live stream itself via
 *     `getUserMedia` (webcam/mic) or `getDisplayMedia` (screen/window) per
 *     `x-zab.sourceKind`, and renders it in a `<video>` for visual kinds
 *     (audio kinds stay visually empty). The physical device is resolved from
 *     the LOGICAL `x-zab.deviceRef` through a host-provided resolver
 *     (`resolveCaptureDevice`, §A1.3) — never a bundle-baked id. Any failure
 *     (no resolver, no device, permission denied, acquisition error) falls
 *     back to PLACEHOLDER WITHOUT throwing or blanking the surrounding tree.
 *
 *   - **PLACEHOLDER** (non-capable host, e.g. CEF/Pulsar on-air) : the box is
 *     fully transparent, acquires nothing, reaches no device — the original
 *     §3.2 behaviour. The consuming app composites a native source behind it
 *     (ON-AIR PATH UNCHANGED).
 *
 *  A stream-less box is a valid mode, not an error : NO diagnostic is emitted
 *  for PLACEHOLDER mode or for an ACQUIRE→PLACEHOLDER fallback.
 *
 *  Geometry is the only layout input. `width`/`height` are the
 *  compiler-flattened `size:{w,h}` ; universal props (visible/opacity/
 *  position) are applied by the Tree's UniversalWrapper. An audio-only
 *  capture (`media.mic` / `media.app_audio`) may omit `size` → a zero-area
 *  box that never paints. */
export function Capture({ resolved }: PrimitiveProps) {
  const width = dimOr(resolved.width, "100%");
  const height = dimOr(resolved.height, "100%");
  const sourceKind =
    typeof resolved["x-zab.sourceKind"] === "string"
      ? (resolved["x-zab.sourceKind"] as string)
      : "";
  const deviceRef =
    typeof resolved["x-zab.deviceRef"] === "string" ? (resolved["x-zab.deviceRef"] as string) : "";

  // §A1.3 — the host-provided resolver, injected at mount through the runtime
  // context (NOT the bundle, NOT the LSDP wire). Absent when the tree renders
  // outside a host (direct embedding, tooling, tests) → the default-device
  // path applies.
  const runtime = useOptionalLumencastRuntime();
  const resolveCaptureDevice = runtime?.resolveCaptureDevice;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  // `null` → PLACEHOLDER (non-capable, or ACQUIRE→PLACEHOLDER fallback).
  // A `MediaStream` → ACQUIRE succeeded and a visual stream is mounted.
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    // §A1.2(2) — capability detection at mount. A non-capable host (no
    // `getUserMedia`, e.g. CEF/Pulsar on-air, or jsdom without a mock) stays
    // in PLACEHOLDER : acquire nothing, no diagnostic.
    if (!isCaptureCapable()) return;

    let cancelled = false;
    let acquired: MediaStream | null = null;

    void (async () => {
      try {
        const media = await acquireStream(sourceKind, deviceRef, resolveCaptureDevice);
        if (media === null) return; // unknown/unsupported kind → PLACEHOLDER
        if (cancelled) {
          // Unmounted (or scene-changed) during acquisition — stop immediately
          // so we never leave a camera light on (RC11).
          stopStream(media);
          return;
        }
        acquired = media;
        setStream(media);
      } catch {
        // §A1.2(2)(a) — any acquisition failure (permission denied, no device,
        // getUserMedia rejected) falls back to PLACEHOLDER, no throw, no
        // diagnostic.
      }
    })();

    return () => {
      cancelled = true;
      // RC11 — stop the tracks at unmount / scene change. Clearing state is
      // unnecessary (the component is gone) but stopping the device is not.
      if (acquired !== null) stopStream(acquired);
    };
    // Re-acquire when the logical source identity changes (a scene switch can
    // reuse the node with a new sourceKind/deviceRef).
  }, [sourceKind, deviceRef, resolveCaptureDevice]);

  // Attach / detach the live stream to the <video> element imperatively —
  // `srcObject` is not a serialisable attribute.
  useEffect(() => {
    const el = videoRef.current;
    if (el === null) return;
    el.srcObject = stream;
    return () => {
      if (el !== null) el.srcObject = null;
    };
  }, [stream]);

  // ACQUIRE with a visual stream → render the <video>. Audio-only kinds keep
  // the transparent box (no visible element) even when acquired.
  if (stream !== null && isVisualKind(sourceKind)) {
    return (
      <video
        ref={videoRef}
        data-lumencast-capture
        autoPlay
        muted
        playsInline
        style={{ width, height, objectFit: "cover", pointerEvents: "none" }}
      />
    );
  }

  // PLACEHOLDER (or audio-only ACQUIRE) — fully transparent, inert box.
  return (
    <div
      aria-hidden
      data-lumencast-capture
      style={{ width, height, opacity: 0, pointerEvents: "none" }}
    />
  );
}

/** A resolved physical device for a live capture constraint, or `null` when the
 *  host could not bind the logical `deviceRef`. */
export type ResolvedCaptureDevice = {
  deviceId?: string;
  captureSourceId?: string;
} | null;

/** Resolver injected by the consuming app (ADR 004 §A1.3). Maps the LOGICAL
 *  `deviceRef` to a physical `deviceId`/`captureSourceId` for a live
 *  `getUserMedia` constraint. The result NEVER enters the bundle or the content
 *  hash. MAY be async: physical ids (e.g. getUserMedia `deviceId`) are salted
 *  per origin/partition, so the host often must re-resolve a portable key
 *  (label) against THIS context's devices — an inherently asynchronous step
 *  (`enumerateDevices`). `acquireStream` awaits it, so the device is bound
 *  before acquisition rather than racing a late global mutation. */
export type ResolveCaptureDevice = (
  deviceRef: string,
  sourceKind: string,
) => ResolvedCaptureDevice | Promise<ResolvedCaptureDevice>;

/** §A1.2(2) — capture-capable iff `navigator.mediaDevices.getUserMedia`
 *  exists and is callable in the current context. Feature detection only ;
 *  CEF/Pulsar on-air and jsdom (without a mock) report non-capable. */
function isCaptureCapable(): boolean {
  return (
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/** Visual kinds render a `<video>` ; audio kinds stay visually empty. */
function isVisualKind(sourceKind: string): boolean {
  return (
    sourceKind === "media.webcam" || sourceKind === "media.screen" || sourceKind === "media.window"
  );
}

/** Acquire a live stream for `sourceKind`, applying a host-resolved `deviceId`
 *  when available. Returns `null` for an unsupported/unknown kind (→
 *  PLACEHOLDER) ; throws are caught by the caller (→ PLACEHOLDER fallback). */
async function acquireStream(
  sourceKind: string,
  deviceRef: string,
  resolveCaptureDevice: ResolveCaptureDevice | undefined,
): Promise<MediaStream | null> {
  const md = navigator.mediaDevices;

  // §A1.3 (amended 2026-06-27) — AWAIT the resolver: physical ids are salted
  // per origin/partition, so the host may need an async re-resolution by a
  // portable key (label) in THIS context. Awaiting binds the device before
  // acquisition instead of racing a late global update (the previous sync call
  // let the node acquire with a stale/absent id first).
  const resolved = (await resolveCaptureDevice?.(deviceRef, sourceKind)) ?? null;
  const deviceId = resolved?.deviceId;
  const declaredRef = deviceRef.length > 0;

  switch (sourceKind) {
    case "media.webcam":
    case "media.mic":
    case "media.app_audio": {
      // §A1.3 (amended) — NO default-device fallback for a DECLARED deviceRef
      // that did not resolve to a real device. Acquiring the host default cam
      // here is the silent "automatic allocation" of the WRONG camera the
      // consuming app must never get. → PLACEHOLDER (return null). The bare
      // default constraint stays ONLY when no deviceRef is declared at all.
      if (declaredRef && (typeof deviceId !== "string" || deviceId.length === 0)) {
        return null;
      }
      const channel = sourceKind === "media.webcam" ? "video" : "audio";
      return md.getUserMedia({ [channel]: deviceConstraint(deviceId) });
    }
    case "media.screen":
    case "media.window": {
      // DIRECT capture of the picked desktopCapturer surface (no system picker)
      // via Electron's legacy `chromeMediaSource:desktop` + the resolved
      // `captureSourceId`.
      const captureSourceId = resolved?.captureSourceId;
      if (typeof captureSourceId === "string" && captureSourceId.length > 0) {
        return md.getUserMedia({
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: captureSourceId,
            },
          } as unknown as MediaTrackConstraints,
        });
      }
      // A declared surface ref that didn't resolve → PLACEHOLDER, never a
      // default `getDisplayMedia` picker. The picker stays only when no ref is
      // declared (a bare capture node on a non-Electron host).
      if (declaredRef) return null;
      return md.getDisplayMedia({ video: true });
    }
    default:
      return null;
  }
}

/** A `getUserMedia` track constraint. A resolved deviceId is pinned with
 *  `exact`, NOT a bare (ideal) deviceId: an *ideal* constraint SILENTLY falls
 *  back to the host default camera when the requested device can't start (e.g.
 *  an INACTIVE virtual cam that's enumerated but produces no stream) — the
 *  "automatic allocation" of the WRONG camera. `exact` yields the requested
 *  device (its placeholder frame if idle), or an OverconstrainedError the
 *  caller catches into PLACEHOLDER — never the wrong cam. No deviceId → `true`
 *  (host default) applies ONLY when no deviceRef was declared. */
function deviceConstraint(deviceId: string | undefined): MediaTrackConstraints | boolean {
  return typeof deviceId === "string" && deviceId.length > 0
    ? { deviceId: { exact: deviceId } }
    : true;
}

/** Stop every track of a stream (RC11 — release the camera/mic, kill the
 *  device light). */
function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** A render dimension: a finite number → px, a non-empty string → verbatim,
 *  anything else → the fallback (matches the `image` primitive's helper). */
function dimOr(v: unknown, fallback: string): string {
  if (typeof v === "number" && Number.isFinite(v)) return `${v}px`;
  if (typeof v === "string" && v.length > 0) return v;
  return fallback;
}
