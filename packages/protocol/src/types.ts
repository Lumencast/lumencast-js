// LSDP/1 wire types and shared shapes.
// Canonical reference: lumencast-protocol/spec/LSDP-1.md (and ERROR-CODES.md, RUNTIME-API.md).

/** LSDP major version. Bumped only on breaking envelope/semantic changes. */
export const PROTOCOL_VERSION = 1 as const;

/** WebSocket subprotocol identifier — see LSDP/1 §1. */
export const WS_SUBPROTOCOL = "lsdp.v1" as const;

/** A leaf path expressed as a dot-separated string. See LSDP/1 §10 for reserved namespaces. */
export type LeafPath = string;

/** A scene identifier — operator-chosen, not derived. */
export type SceneId = string;

/** A scene version — sha256 hash prefixed with `sha256:`. */
export type SceneVersion = string;

/** A test session identifier. */
export type SessionId = string;

/** Permitted JSON values inside a `delta.patches[].value`. Objects are forbidden — push leaf-grain. */
export type LeafValue = string | number | boolean | null | LeafValue[];

/** Closed taxonomy of LSDP/1 error codes. Match by exact string equality. */
export type ErrorCode =
  | "AUTH_DENIED"
  | "WRITE_FORBIDDEN"
  | "SCENE_NOT_FOUND"
  | "BUNDLE_FETCH_FAILED"
  | "BUNDLE_INCOMPATIBLE"
  | "VERSION_GAP"
  | "VERSION_MISMATCH"
  | "UNKNOWN_PATH"
  | "INVALID_VALUE"
  | "RATE_LIMIT"
  | "TEST_SESSION_EXPIRED"
  | "INTERNAL";

/** A leaf-grain patch. */
export interface Patch {
  path: LeafPath;
  value: LeafValue;
}

// --- Server → client frames -------------------------------------------------

interface BaseFrame {
  v: typeof PROTOCOL_VERSION;
  /** Monotonically increasing per subscription. Required on server frames except `pong`. */
  seq?: number;
  /** ISO 8601 timestamp. SHOULD be sent on snapshots and errors; MAY be omitted on deltas. */
  ts?: string;
}

export interface SnapshotFrame extends BaseFrame {
  type: "snapshot";
  seq: number;
  scene_id: SceneId;
  scene_version: SceneVersion;
  /** Flat dictionary of leaf paths to JSON values. */
  state: Record<LeafPath, LeafValue>;
}

export interface DeltaFrame extends BaseFrame {
  type: "delta";
  seq: number;
  /** Non-empty array of patches; applied left-to-right, atomic per frame. */
  patches: Patch[];
}

export interface SceneChangedFrame extends BaseFrame {
  type: "scene_changed";
  seq: number;
  scene_id: SceneId;
  scene_version: SceneVersion;
}

export interface ErrorFrame extends BaseFrame {
  type: "error";
  seq: number;
  code: ErrorCode;
  message: string;
  recoverable: boolean;
  /**
   * REQUIRED for path-scoped codes (`WRITE_FORBIDDEN`, `UNKNOWN_PATH`,
   * `INVALID_VALUE`) per LSDP/1.0.1 §3.4.1. Forbidden for codes that
   * are not path-scoped.
   */
  path?: LeafPath;
  /** Optional, for `RATE_LIMIT`. */
  retry_after_ms?: number;
  /** Optional, for `BUNDLE_INCOMPATIBLE`. */
  requested_version?: string;
  supported_version?: string;
  /** Optional, for `TEST_SESSION_EXPIRED`. */
  session?: string;
}

export interface PongFrame {
  v: typeof PROTOCOL_VERSION;
  type: "pong";
}

export type ServerFrame = SnapshotFrame | DeltaFrame | SceneChangedFrame | ErrorFrame | PongFrame;

// --- Client → server frames -------------------------------------------------

export interface SubscribeFrame {
  v: typeof PROTOCOL_VERSION;
  type: "subscribe";
  /** Opaque authentication token. */
  token: string;
  /** Required for test mode (preview a specific scene); forbidden for live. */
  scene?: SceneId;
  /** Required for test mode with isolated session; forbidden otherwise. */
  session?: SessionId;
}

export interface InputFrame {
  v: typeof PROTOCOL_VERSION;
  type: "input";
  /** Non-empty. Server validates each path against active scene's `operator_inputs`. */
  patches: Patch[];
}

export interface PingFrame {
  v: typeof PROTOCOL_VERSION;
  type: "ping";
}

export type ClientFrame = SubscribeFrame | InputFrame | PingFrame;
