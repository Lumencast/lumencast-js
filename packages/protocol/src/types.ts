// LSDP/1 wire types and shared shapes.
// Canonical reference: lumencast-protocol/spec/LSDP-1.md (and ERROR-CODES.md, RUNTIME-API.md).

/** LSDP major version. Bumped only on breaking envelope/semantic changes. */
export const PROTOCOL_VERSION = 1 as const;

/** LSDP/1.0 WebSocket subprotocol — see LSDP/1 §1. Kept for 1.0 client compat. */
export const WS_SUBPROTOCOL = "lsdp.v1" as const;

/** LSDP/1.1 WebSocket subprotocol — opts into the additive 1.1 frame surface
 * (since_sequence resume, unsubscribe, transition, cause, nonce, client_msg_id,
 * from_scene_id + show transition). See LSDP/1.1 envelope/header section. */
export const WS_SUBPROTOCOL_V1_1 = "lsdp.v1.1" as const;

/** Canonical advertise/accept list, ordered by preference (1.1 first, 1.0 fallback). */
export const WS_SUBPROTOCOLS = [WS_SUBPROTOCOL_V1_1, WS_SUBPROTOCOL] as const;

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

/** Per-leaf animation directive on a delta patch (LSDP/1.1 §3.2.2).
 * Servers MAY emit ; runtimes interpret when applying the new value.
 * 1.0 receivers ignore. */
export interface TransitionSpec {
  kind: "tween" | "spring" | "snap";
  /** tween only */
  duration_ms?: number;
  /** tween only */
  easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out";
  /** spring only */
  stiffness?: number;
  /** spring only */
  damping?: number;
}

/** Optional provenance metadata on a delta (LSDP/1.1 §3.2.3). Receivers
 * MUST NOT use it for semantic decisions — debug/audit only. */
export interface Cause {
  /** e.g. "operator:user-abc", "adapter:http_poll", "service:ranker" */
  source: string;
  /** Echoes InputFrame.client_msg_id verbatim when the delta was caused
   * by an operator input. */
  input_id?: string;
}

/** Show-level scene-swap transition on a scene_changed frame
 * (LSDP/1.1 §3.3.1). Runtimes that don't recognise `kind` fall back
 * to crossfade. */
export interface SceneTransition {
  kind: "crossfade" | (string & {}); // open string for vendor kinds
  duration_ms?: number;
}

/** A leaf-grain patch. */
export interface Patch {
  path: LeafPath;
  value: LeafValue;
  /** Optional 1.1 per-leaf transition directive. */
  transition?: TransitionSpec;
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
  /** Optional provenance (LSDP/1.1 §3.2.3). Debug/audit only. */
  cause?: Cause;
}

export interface SceneChangedFrame extends BaseFrame {
  type: "scene_changed";
  seq: number;
  scene_id: SceneId;
  scene_version: SceneVersion;
  /** Previously active scene id (LSDP/1.1 §3.3.1). 1.0 receivers ignore. */
  from_scene_id?: SceneId;
  /** Show-level transition between old and new scene (LSDP/1.1 §3.3.1). */
  transition?: SceneTransition;
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
  /** Echoes PingFrame.nonce verbatim (LSDP/1.1 §3.5). 1.0 servers omit. */
  nonce?: string;
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
  /** Last seq the client successfully observed before disconnect
   * (LSDP/1.1 §4.1, §18). Server resumes with deltas from
   * since_sequence+1 if the replay buffer covers, else fresh snapshot.
   * 1.0 servers MUST ignore this field. Omit (or 0) means no resume. */
  since_sequence?: number;
}

export interface InputFrame {
  v: typeof PROTOCOL_VERSION;
  type: "input";
  /** Non-empty. Server validates each path against active scene's `operator_inputs`. */
  patches: Patch[];
  /** Free-form correlation tag (LSDP/1.1 §4.2). Server MUST echo
   * verbatim in the resulting Delta.cause.input_id. 1.0 servers ignore. */
  client_msg_id?: string;
}

export interface PingFrame {
  v: typeof PROTOCOL_VERSION;
  type: "ping";
  /** Free-form correlation identifier (LSDP/1.1 §4.3). Receiver MUST
   * echo verbatim in the Pong reply. */
  nonce?: string;
}

/** Clean teardown signal (LSDP/1.1 §4.4). Server MUST close the
 * WebSocket within 1 second of receipt. No data flows after. */
export interface UnsubscribeFrame {
  v: typeof PROTOCOL_VERSION;
  type: "unsubscribe";
}

export type ClientFrame = SubscribeFrame | InputFrame | PingFrame | UnsubscribeFrame;
