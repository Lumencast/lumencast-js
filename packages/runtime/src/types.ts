// Public types of @lumencast/runtime — must align with RUNTIME-API.md.

import type { ErrorCode } from "@lumencast/protocol";
import type { ResolveCaptureDevice } from "./render/primitives/capture";

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
}

export interface LumencastHandle {
  /** Tear down the WS, unmount the React tree, release timers. Idempotent. */
  disconnect: () => void;
  /** Swap the auth token without unmounting the React tree. */
  setToken: (token: LumencastToken) => void;
}

export type { ErrorCode };
