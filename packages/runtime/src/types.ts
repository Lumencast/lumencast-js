// Public types of @lumencast/runtime — must align with RUNTIME-API.md.

import type { ErrorCode, SceneRosterEntry } from "@lumencast/protocol";
import type { RenderNode } from "./render/bundle";
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
    | "scene_changed"
    /** A render bundle was warmed ahead of time from a roster entry (either a
     *  `scene_roster` frame or the `preloadRoster` mount option). Emitted once
     *  the warm fetch resolves (or from cache). Carries `scene_id` +
     *  `scene_version` + `source` ("frame" | "option"). */
    | "roster_preloaded";
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
  /** Un-mute the live `<video>` of `meet.peer` / `x-zab.meet-peer` peers so the
   *  guest's WebRTC audio track joins the page's audio output (and thus the
   *  on-air / recording mix — an OBS/Pulsar `browser_source` captures page audio
   *  by default). Muted by default (omitted / `false`) to preserve the current
   *  behaviour for every consumer that does not opt in.
   *
   *  DANGER — set this ONLY on a host that KNOWS it is the flux réellement
   *  diffusé/enregistré (the antenne, the REC/test render, the Pulsar CEF atlas).
   *  NEVER set it on an interactive preview/editor host (e.g. the Prism editor
   *  webview) : the operator may have the same ZabCam room open elsewhere and
   *  un-muting the peer there would create audio feedback / echo. */
  liveAudio?: boolean;
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
  /** Preload the render bundles of a known scene roster so the FIRST switch to
   *  each scene is instant (a warm cache hit instead of a blocking fetch).
   *  Each entry is `{ scene_id, scene_version }`. Warmed in the background right
   *  after mount — best-effort: a failed warm is swallowed (the scene still
   *  fetches on demand at switch time) and never blocks or errors the mount.
   *
   *  This is the PUBLIC preload surface (lumencast-js #87b) for hosts that
   *  already know the roster at mount time. When the server also emits
   *  `scene_roster` frames the runtime warms from those too — both paths feed
   *  the same cache and are idempotent (a version is warmed at most once). */
  preloadRoster?: readonly SceneRosterEntry[];
  /** ADR 013 (Prism) — pure transform applied to a fetched render bundle's
   *  `root` node once, right before it is handed to the renderer for the
   *  first paint of that bundle. The transformed tree is what actually
   *  renders; the runtime never mutates the fetched bundle (the cached copy
   *  stays pristine, so a scene switch re-transforms the original root, not
   *  an already-transformed one).
   *
   *  Runs on the BUNDLE load path only (the initial snapshot and every
   *  subsequent scene switch) — NEVER per delta. Deltas remain flat patches
   *  applied to leaves by their state path in the store (`state/store.ts`,
   *  one signal per leaf-path); they do not re-run this hook.
   *
   *  INVARIANT — the store is flat and addresses leaves by path. A transform
   *  MAY reparent existing nodes under new wrapper frames and MAY rewrite
   *  geometry, but it MUST NOT change any leaf's `id` or the state path its
   *  bindings resolve to. Re-keying a leaf would orphan the deltas that keep
   *  addressing it by its original path. As long as only the parent / z-order
   *  / geometry changes (never the leaf-path), the transform stays delta-safe
   *  — a later delta targeting a reparented leaf by its original path still
   *  applies. This is the exact contract Solar's `buildAtlasRoot`
   *  (RenderNode → RenderNode, z-band splitting) relies on (issue #95).
   *
   *  Omit it and `mount()` behaves exactly as before (strict non-regression):
   *  the fetched bundle is rendered verbatim. */
  transformRoot?: (root: RenderNode) => RenderNode;
}

export interface LumencastHandle {
  /** Tear down the WS, unmount the React tree, release timers. Idempotent. */
  disconnect: () => void;
  /** Swap the auth token without unmounting the React tree. */
  setToken: (token: LumencastToken) => void;
}

export type { ErrorCode };
