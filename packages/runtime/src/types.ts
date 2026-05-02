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
}

export interface LumencastHandle {
  /** Tear down the WS, unmount the React tree, release timers. Idempotent. */
  disconnect: () => void;
  /** Swap the auth token without unmounting the React tree. */
  setToken: (token: LumencastToken) => void;
}

export type { ErrorCode };
