// Public types of @lumencast/runtime — must align with RUNTIME-API.md.

import type { ErrorCode } from "@lumencast/protocol";
import type { ResolveCaptureDevice } from "./render/primitives/capture";
import type { ResolvePeerStream, SubscribePeerStream } from "./render/primitives/media";
import type { ReservedCamLeaves } from "./state/reserved-leaves";

export type LumencastMode = "broadcast" | "control" | "test";

export type LumencastStatus = "disconnected" | "connecting" | "live";

export interface LumencastTokenProvider {
  fetch: () => Promise<string>;
}

export type LumencastToken = string | LumencastTokenProvider;

export interface LumencastError {
  code: ErrorCode;
  message: string;
  recoverable: boolean;
}

export interface LumencastMetric {
  name:
    | "delta_received"
    | "delta_applied"
    | "frame_dropped"
    | "reconnect"
    | "snapshot_received"
    | "scene_changed";
  [key: string]: unknown;
}

/** Anti-silent-drop render diagnostic (ADR 001 §3.4, issue #34).
 *  Carries node identity + field + static reason — NEVER a leaf or
 *  prop value (Bastion R9). */
export interface LumencastDiagnostic {
  nodeId: string;
  field: string;
  reason: string;
}

export interface MountOptions {
  target: HTMLElement;
  /** WebSocket URL of the LSDP/1 server (wss://... in production). */
  serverUrl: string;
  token: LumencastToken;
  mode: LumencastMode;
  /** Required when mode === "test". */
  testSession?: string;
  /** Required when mode === "test". */
  scene?: string;
  /** Resolve the absolute URL of a scene's render bundle. Use this when the
   *  server is not at the default host-root LSDP/1 layout — e.g. reached
   *  through a gateway prefix. Given `(sceneId, sceneVersion)`, return the
   *  full URL to fetch, including query string. When omitted, the runtime
   *  derives `https://<host>/lsdp/v1/scenes/{id}/bundle?v={hash}` from
   *  `serverUrl` (unchanged v0.4.0 behaviour).
   *
   *  @example
   *  // Orion behind ZabGate:
   *  resolveBundleUrl: (id, v) =>
   *    `https://zabgate.cyell.dev/orion/api/v1/scenes/${id}/render-bundle?v=${v}`
   */
  resolveBundleUrl?: (sceneId: string, sceneVersion: string) => string;
  onStatus?: (status: LumencastStatus) => void;
  onError?: (err: LumencastError) => void;
  onMetric?: (metric: LumencastMetric) => void;
  /** Anti-silent-drop diagnostics stream (ADR 001 §3.4) : rejected
   *  values, unknown props, spec'd-but-unrendered fields. Events, not
   *  logs — `broadcast` builds stay console-silent. When omitted, the
   *  runtime falls back to a DEV-only console.warn. */
  onDiagnostic?: (diagnostic: LumencastDiagnostic) => void;
  /** ADR 004 §A1.3 — host resolver for the `x-zab.capture` primitive's ACQUIRE
   *  mode. Given the LOGICAL `(deviceRef, sourceKind)` from the bundle, return
   *  `{ deviceId }` to pin a physical device, or `null` for the host's default
   *  device. The runtime passes `deviceId` only as a live `getUserMedia`
   *  constraint — it NEVER enters the bundle or the content hash. Omit it and
   *  ACQUIRE uses the default device ("the cam traverses"), never throwing.
   *  Only consulted on a capture-capable host (e.g. the Electron preview
   *  webview) ; ignored on-air (CEF/Pulsar render the placeholder). */
  resolveCaptureDevice?: ResolveCaptureDevice;
  /** ADR 006 #4 — host resolver for the `media` primitive's LIVE mode. Given a
   *  LOGICAL `peerLabel` (a `meet.peer.peer_label` from the scene), return the
   *  live `MediaStream` of that peer, or `null` when it is not connected yet.
   *  Supplied by the WebRTC viewer (issue #3) ; the stream is rendered in
   *  `<video>.srcObject` and NEVER enters the bundle or the content hash. Omit
   *  it and a live `media` node renders a stream-less box, never throwing. */
  resolvePeerStream?: ResolvePeerStream;
  /** ADR 006 #3 — reactive variant of `resolvePeerStream` : the viewer pushes a
   *  peer's stream on connect and `null` on leave, so a LIVE `media` node
   *  re-renders when its peer joins mid-show. `createPeerViewer()` returns one.
   *  Preferred over `resolvePeerStream` when both are supplied. */
  subscribePeerStream?: SubscribePeerStream;
  /** ADR Blue 009 §3.2–3.3 — host sink for the reserved `__cam.*` LSDP leaves
   *  (never rendered, never bound to a node). Called with the full current
   *  projection whenever it changes : `viewer` carries the receive-only viewer
   *  creds (`__cam.viewer`, Orion #268) and `slots` the `slotRef → peer_label`
   *  snapshot (`__cam.slots.*`, Orion #267). The host (Solar) feeds `viewer` into
   *  its peer-viewer injection and drives its slot-binding registry's
   *  `assign(slotRef, peer_label | null)` so `x-zab.meet-peer` nodes re-key by
   *  `slotRef`. Receive-only : the runtime forwards the token verbatim, never
   *  reads it. Omit it and the reserved leaves are simply not surfaced (the
   *  preview/headless paths are unaffected). */
  onReservedLeaves?: (leaves: ReservedCamLeaves) => void;
}

export interface LumencastHandle {
  /** Tear down the WS, unmount the React tree, release timers. Idempotent. */
  disconnect: () => void;
  /** Swap the auth token without unmounting the React tree. */
  setToken: (token: LumencastToken) => void;
}

export type { ErrorCode };
