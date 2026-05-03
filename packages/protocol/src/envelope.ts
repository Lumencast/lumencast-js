// Envelope helpers — convenience constructors that stamp `v` automatically.
// Useful when emitting frames from a server or test fixture.

import {
  PROTOCOL_VERSION,
  type Cause,
  type DeltaFrame,
  type ErrorCode,
  type ErrorFrame,
  type InputFrame,
  type LeafPath,
  type LeafValue,
  type Patch,
  type PingFrame,
  type PongFrame,
  type SceneChangedFrame,
  type SceneId,
  type SceneTransition,
  type SceneVersion,
  type SessionId,
  type SnapshotFrame,
  type SubscribeFrame,
  type UnsubscribeFrame,
} from "./types.js";

export interface SnapshotInit {
  seq: number;
  scene_id: SceneId;
  scene_version: SceneVersion;
  state: Record<LeafPath, LeafValue>;
  ts?: string;
}

export function snapshot(init: SnapshotInit): SnapshotFrame {
  const frame: SnapshotFrame = {
    v: PROTOCOL_VERSION,
    type: "snapshot",
    seq: init.seq,
    scene_id: init.scene_id,
    scene_version: init.scene_version,
    state: init.state,
  };
  if (init.ts !== undefined) frame.ts = init.ts;
  return frame;
}

export interface DeltaInit {
  seq: number;
  patches: Patch[];
  ts?: string;
  /** LSDP/1.1 §3.2.3 — optional provenance metadata. */
  cause?: Cause;
}

export function delta(init: DeltaInit): DeltaFrame {
  if (init.patches.length === 0) {
    throw new Error("delta.patches must be non-empty");
  }
  const frame: DeltaFrame = {
    v: PROTOCOL_VERSION,
    type: "delta",
    seq: init.seq,
    patches: init.patches,
  };
  if (init.ts !== undefined) frame.ts = init.ts;
  if (init.cause !== undefined) frame.cause = init.cause;
  return frame;
}

export interface SceneChangedInit {
  seq: number;
  scene_id: SceneId;
  scene_version: SceneVersion;
  ts?: string;
  /** LSDP/1.1 §3.3.1 — previously active scene id. */
  from_scene_id?: SceneId;
  /** LSDP/1.1 §3.3.1 — show-level scene transition. */
  transition?: SceneTransition;
}

export function sceneChanged(init: SceneChangedInit): SceneChangedFrame {
  const frame: SceneChangedFrame = {
    v: PROTOCOL_VERSION,
    type: "scene_changed",
    seq: init.seq,
    scene_id: init.scene_id,
    scene_version: init.scene_version,
  };
  if (init.ts !== undefined) frame.ts = init.ts;
  if (init.from_scene_id !== undefined) frame.from_scene_id = init.from_scene_id;
  if (init.transition !== undefined) frame.transition = init.transition;
  return frame;
}

export interface ErrorInit {
  seq: number;
  code: ErrorCode;
  message: string;
  recoverable: boolean;
  /**
   * REQUIRED for path-scoped codes (`WRITE_FORBIDDEN`, `UNKNOWN_PATH`,
   * `INVALID_VALUE`) per LSDP/1.0.1 §3.4.1.
   */
  path?: LeafPath;
  retry_after_ms?: number;
  requested_version?: string;
  supported_version?: string;
  session?: string;
  ts?: string;
}

export function errorFrame(init: ErrorInit): ErrorFrame {
  const frame: ErrorFrame = {
    v: PROTOCOL_VERSION,
    type: "error",
    seq: init.seq,
    code: init.code,
    message: init.message,
    recoverable: init.recoverable,
  };
  if (init.path !== undefined) frame.path = init.path;
  if (init.retry_after_ms !== undefined) frame.retry_after_ms = init.retry_after_ms;
  if (init.requested_version !== undefined) frame.requested_version = init.requested_version;
  if (init.supported_version !== undefined) frame.supported_version = init.supported_version;
  if (init.session !== undefined) frame.session = init.session;
  if (init.ts !== undefined) frame.ts = init.ts;
  return frame;
}

export function pong(nonce?: string): PongFrame {
  const frame: PongFrame = { v: PROTOCOL_VERSION, type: "pong" };
  if (nonce !== undefined) frame.nonce = nonce;
  return frame;
}

export interface SubscribeInit {
  token: string;
  scene?: SceneId;
  session?: SessionId;
  /** LSDP/1.1 §4.1 — incremental resume from a known last-seen seq. */
  since_sequence?: number;
}

export function subscribe(init: SubscribeInit): SubscribeFrame {
  const frame: SubscribeFrame = {
    v: PROTOCOL_VERSION,
    type: "subscribe",
    token: init.token,
  };
  if (init.scene !== undefined) frame.scene = init.scene;
  if (init.session !== undefined) frame.session = init.session;
  if (init.since_sequence !== undefined) frame.since_sequence = init.since_sequence;
  return frame;
}

export interface InputInit {
  patches: Patch[];
  /** LSDP/1.1 §4.2 — optimistic-UI correlation tag. */
  client_msg_id?: string;
}

export function input(patches: Patch[], init?: { client_msg_id?: string }): InputFrame {
  if (patches.length === 0) {
    throw new Error("input.patches must be non-empty");
  }
  const frame: InputFrame = { v: PROTOCOL_VERSION, type: "input", patches };
  if (init?.client_msg_id !== undefined) frame.client_msg_id = init.client_msg_id;
  return frame;
}

export function ping(nonce?: string): PingFrame {
  const frame: PingFrame = { v: PROTOCOL_VERSION, type: "ping" };
  if (nonce !== undefined) frame.nonce = nonce;
  return frame;
}

/** LSDP/1.1 §4.4 — clean teardown signal. */
export function unsubscribe(): UnsubscribeFrame {
  return { v: PROTOCOL_VERSION, type: "unsubscribe" };
}
