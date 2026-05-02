// Envelope helpers — convenience constructors that stamp `v` automatically.
// Useful when emitting frames from a server or test fixture.

import {
  PROTOCOL_VERSION,
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
  type SceneVersion,
  type SessionId,
  type SnapshotFrame,
  type SubscribeFrame,
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
  return frame;
}

export interface SceneChangedInit {
  seq: number;
  scene_id: SceneId;
  scene_version: SceneVersion;
  ts?: string;
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
  return frame;
}

export interface ErrorInit {
  seq: number;
  code: ErrorCode;
  message: string;
  recoverable: boolean;
  retry_after_ms?: number;
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
  if (init.retry_after_ms !== undefined) frame.retry_after_ms = init.retry_after_ms;
  if (init.ts !== undefined) frame.ts = init.ts;
  return frame;
}

export function pong(): PongFrame {
  return { v: PROTOCOL_VERSION, type: "pong" };
}

export interface SubscribeInit {
  token: string;
  scene?: SceneId;
  session?: SessionId;
}

export function subscribe(init: SubscribeInit): SubscribeFrame {
  const frame: SubscribeFrame = {
    v: PROTOCOL_VERSION,
    type: "subscribe",
    token: init.token,
  };
  if (init.scene !== undefined) frame.scene = init.scene;
  if (init.session !== undefined) frame.session = init.session;
  return frame;
}

export function input(patches: Patch[]): InputFrame {
  if (patches.length === 0) {
    throw new Error("input.patches must be non-empty");
  }
  return { v: PROTOCOL_VERSION, type: "input", patches };
}

export function ping(): PingFrame {
  return { v: PROTOCOL_VERSION, type: "ping" };
}
