// Public types of @lumencast/runtime — must align with RUNTIME-API.md.

import type { ErrorCode } from "@lumencast/protocol";

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
  onStatus?: (status: LumencastStatus) => void;
  onError?: (err: LumencastError) => void;
  onMetric?: (metric: LumencastMetric) => void;
  /** Anti-silent-drop diagnostics stream (ADR 001 §3.4) : rejected
   *  values, unknown props, spec'd-but-unrendered fields. Events, not
   *  logs — `broadcast` builds stay console-silent. When omitted, the
   *  runtime falls back to a DEV-only console.warn. */
  onDiagnostic?: (diagnostic: LumencastDiagnostic) => void;
}

export interface LumencastHandle {
  /** Tear down the WS, unmount the React tree, release timers. Idempotent. */
  disconnect: () => void;
  /** Swap the auth token without unmounting the React tree. */
  setToken: (token: LumencastToken) => void;
}

export type { ErrorCode };
