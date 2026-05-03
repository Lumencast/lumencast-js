// JSON envelope codec for LSDP/1 frames.
// Hand-rolled type guards rather than a schema library — keeps the bundle
// weight off the runtime hot path and the surface auditable.

import { LumencastError } from "./errors.js";
import { isProtocolErrorCode } from "./errors.js";
import {
  PROTOCOL_VERSION,
  type Cause,
  type ClientFrame,
  type DeltaFrame,
  type ErrorFrame,
  type InputFrame,
  type LeafValue,
  type Patch,
  type PingFrame,
  type PongFrame,
  type SceneChangedFrame,
  type SceneTransition,
  type ServerFrame,
  type SnapshotFrame,
  type SubscribeFrame,
  type TransitionSpec,
  type UnsubscribeFrame,
} from "./types.js";

/** Encode any LSDP frame to its on-wire JSON string. */
export function encodeFrame(frame: ClientFrame | ServerFrame): string {
  return JSON.stringify(frame);
}

/**
 * Decode a JSON text frame into a typed `ServerFrame`.
 *
 * Throws `LumencastError` with `INTERNAL` if the bytes are not valid JSON,
 * are not an object, or carry an unsupported `v`. Unknown `type` values
 * resolve to `null` (forward-compatibility — receivers MUST ignore unknown
 * frame types per LSDP/1 §13).
 */
export function decodeServerFrame(raw: string): ServerFrame | null {
  const parsed = parseJsonObject(raw);
  validateEnvelope(parsed);

  switch (parsed["type"]) {
    case "snapshot":
      return decodeSnapshot(parsed);
    case "delta":
      return decodeDelta(parsed);
    case "scene_changed":
      return decodeSceneChanged(parsed);
    case "error":
      return decodeError(parsed);
    case "pong":
      return decodePong(parsed);
    default:
      return null;
  }
}

/** Decode a JSON text frame into a typed `ClientFrame`. Same forward-compat rule. */
export function decodeClientFrame(raw: string): ClientFrame | null {
  const parsed = parseJsonObject(raw);
  validateEnvelope(parsed);

  switch (parsed["type"]) {
    case "subscribe":
      return decodeSubscribe(parsed);
    case "input":
      return decodeInput(parsed);
    case "ping":
      return decodePing(parsed);
    case "unsubscribe":
      return decodeUnsubscribe(parsed);
    default:
      return null;
  }
}

// --- decoders ---------------------------------------------------------------

function decodeSnapshot(o: Record<string, unknown>): SnapshotFrame {
  requireFields(o, ["seq", "scene_id", "scene_version", "state"]);
  const state = o["state"];
  if (!isPlainObject(state)) {
    throw protocolError(`snapshot.state must be an object`);
  }
  for (const [path, value] of Object.entries(state)) {
    assertLeafValue(value, `snapshot.state[${path}]`);
  }
  return {
    v: PROTOCOL_VERSION,
    type: "snapshot",
    seq: assertInt(o["seq"], "snapshot.seq"),
    scene_id: assertString(o["scene_id"], "snapshot.scene_id"),
    scene_version: assertString(o["scene_version"], "snapshot.scene_version"),
    state: state as Record<string, LeafValue>,
    ...optionalTs(o),
  };
}

function decodeDelta(o: Record<string, unknown>): DeltaFrame {
  requireFields(o, ["seq", "patches"]);
  const frame: DeltaFrame = {
    v: PROTOCOL_VERSION,
    type: "delta",
    seq: assertInt(o["seq"], "delta.seq"),
    patches: assertPatches(o["patches"], "delta.patches"),
    ...optionalTs(o),
  };
  if (o["cause"] !== undefined) {
    frame.cause = assertCause(o["cause"], "delta.cause");
  }
  return frame;
}

function decodeSceneChanged(o: Record<string, unknown>): SceneChangedFrame {
  requireFields(o, ["seq", "scene_id", "scene_version"]);
  const frame: SceneChangedFrame = {
    v: PROTOCOL_VERSION,
    type: "scene_changed",
    seq: assertInt(o["seq"], "scene_changed.seq"),
    scene_id: assertString(o["scene_id"], "scene_changed.scene_id"),
    scene_version: assertString(o["scene_version"], "scene_changed.scene_version"),
    ...optionalTs(o),
  };
  if (typeof o["from_scene_id"] === "string") {
    frame.from_scene_id = o["from_scene_id"];
  }
  if (o["transition"] !== undefined) {
    frame.transition = assertSceneTransition(o["transition"], "scene_changed.transition");
  }
  return frame;
}

function decodeError(o: Record<string, unknown>): ErrorFrame {
  requireFields(o, ["seq", "code", "message", "recoverable"]);
  const code = o["code"];
  if (!isProtocolErrorCode(code)) {
    throw protocolError(`error.code is not in the closed taxonomy: ${String(code)}`);
  }
  const message = assertString(o["message"], "error.message");
  if (typeof o["recoverable"] !== "boolean") {
    throw protocolError(`error.recoverable must be boolean`);
  }
  const frame: ErrorFrame = {
    v: PROTOCOL_VERSION,
    type: "error",
    seq: assertInt(o["seq"], "error.seq"),
    code,
    message,
    recoverable: o["recoverable"],
    ...optionalTs(o),
  };
  if (o["retry_after_ms"] !== undefined) {
    frame.retry_after_ms = assertInt(o["retry_after_ms"], "error.retry_after_ms");
  }
  return frame;
}

function decodePong(o: Record<string, unknown>): PongFrame {
  const frame: PongFrame = { v: PROTOCOL_VERSION, type: "pong" };
  if (typeof o["nonce"] === "string") {
    frame.nonce = o["nonce"];
  }
  return frame;
}

function decodeSubscribe(o: Record<string, unknown>): SubscribeFrame {
  requireFields(o, ["token"]);
  const frame: SubscribeFrame = {
    v: PROTOCOL_VERSION,
    type: "subscribe",
    token: assertString(o["token"], "subscribe.token"),
  };
  if (o["scene"] !== undefined && o["scene"] !== null) {
    frame.scene = assertString(o["scene"], "subscribe.scene");
  }
  if (o["session"] !== undefined && o["session"] !== null) {
    frame.session = assertString(o["session"], "subscribe.session");
  }
  if (o["since_sequence"] !== undefined) {
    frame.since_sequence = assertInt(o["since_sequence"], "subscribe.since_sequence");
  }
  return frame;
}

function decodeInput(o: Record<string, unknown>): InputFrame {
  requireFields(o, ["patches"]);
  const frame: InputFrame = {
    v: PROTOCOL_VERSION,
    type: "input",
    patches: assertPatches(o["patches"], "input.patches"),
  };
  if (typeof o["client_msg_id"] === "string") {
    frame.client_msg_id = o["client_msg_id"];
  }
  return frame;
}

function decodePing(o: Record<string, unknown>): PingFrame {
  const frame: PingFrame = { v: PROTOCOL_VERSION, type: "ping" };
  if (typeof o["nonce"] === "string") {
    frame.nonce = o["nonce"];
  }
  return frame;
}

function decodeUnsubscribe(_o: Record<string, unknown>): UnsubscribeFrame {
  return { v: PROTOCOL_VERSION, type: "unsubscribe" };
}

// --- envelope validation ----------------------------------------------------

function parseJsonObject(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw protocolError(`frame is not valid JSON`);
  }
  if (!isPlainObject(parsed)) {
    throw protocolError(`frame is not a JSON object`);
  }
  return parsed;
}

function validateEnvelope(o: Record<string, unknown>): void {
  if (o["v"] !== PROTOCOL_VERSION) {
    throw protocolError(`envelope.v must be ${PROTOCOL_VERSION}, got ${String(o["v"])}`);
  }
  if (typeof o["type"] !== "string") {
    throw protocolError(`envelope.type must be a string`);
  }
}

// --- assertion primitives ---------------------------------------------------

function requireFields(o: Record<string, unknown>, fields: string[]): void {
  for (const f of fields) {
    if (!(f in o)) {
      throw protocolError(`missing required field: ${f}`);
    }
  }
}

function assertString(v: unknown, label: string): string {
  if (typeof v !== "string") {
    throw protocolError(`${label} must be a string`);
  }
  return v;
}

function assertInt(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw protocolError(`${label} must be an integer`);
  }
  return v;
}

function assertPatches(v: unknown, label: string): Patch[] {
  if (!Array.isArray(v) || v.length === 0) {
    throw protocolError(`${label} must be a non-empty array`);
  }
  return v.map((p, i) => {
    if (!isPlainObject(p)) {
      throw protocolError(`${label}[${i}] must be an object`);
    }
    if (typeof p["path"] !== "string") {
      throw protocolError(`${label}[${i}].path must be a string`);
    }
    assertLeafValue(p["value"], `${label}[${i}].value`, p["path"]);
    const patch: Patch = { path: p["path"], value: p["value"] as LeafValue };
    if (p["transition"] !== undefined) {
      patch.transition = assertTransitionSpec(p["transition"], `${label}[${i}].transition`);
    }
    return patch;
  });
}

function assertTransitionSpec(v: unknown, label: string): TransitionSpec {
  if (!isPlainObject(v)) {
    throw protocolError(`${label} must be an object`);
  }
  const kind = v["kind"];
  if (kind !== "tween" && kind !== "spring" && kind !== "snap") {
    throw protocolError(`${label}.kind must be one of "tween", "spring", "snap"`);
  }
  const spec: TransitionSpec = { kind };
  if (v["duration_ms"] !== undefined) {
    spec.duration_ms = assertInt(v["duration_ms"], `${label}.duration_ms`);
  }
  if (typeof v["easing"] === "string") {
    const e = v["easing"];
    if (e !== "linear" && e !== "ease-in" && e !== "ease-out" && e !== "ease-in-out") {
      throw protocolError(`${label}.easing must be one of "linear", "ease-in", "ease-out", "ease-in-out"`);
    }
    spec.easing = e;
  }
  if (v["stiffness"] !== undefined) {
    if (typeof v["stiffness"] !== "number") {
      throw protocolError(`${label}.stiffness must be a number`);
    }
    spec.stiffness = v["stiffness"];
  }
  if (v["damping"] !== undefined) {
    if (typeof v["damping"] !== "number") {
      throw protocolError(`${label}.damping must be a number`);
    }
    spec.damping = v["damping"];
  }
  return spec;
}

function assertCause(v: unknown, label: string): Cause {
  if (!isPlainObject(v)) {
    throw protocolError(`${label} must be an object`);
  }
  const source = v["source"];
  if (typeof source !== "string") {
    throw protocolError(`${label}.source must be a string`);
  }
  const cause: Cause = { source };
  if (typeof v["input_id"] === "string") {
    cause.input_id = v["input_id"];
  }
  return cause;
}

function assertSceneTransition(v: unknown, label: string): SceneTransition {
  if (!isPlainObject(v)) {
    throw protocolError(`${label} must be an object`);
  }
  if (typeof v["kind"] !== "string") {
    throw protocolError(`${label}.kind must be a string`);
  }
  const t: SceneTransition = { kind: v["kind"] as SceneTransition["kind"] };
  if (v["duration_ms"] !== undefined) {
    t.duration_ms = assertInt(v["duration_ms"], `${label}.duration_ms`);
  }
  return t;
}

function assertLeafValue(v: unknown, label: string, path?: string): asserts v is LeafValue {
  if (v === null) return;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return;
  if (Array.isArray(v)) {
    v.forEach((item, i) => assertLeafValue(item, `${label}[${i}]`, path));
    return;
  }
  // Per LSDP/1.0.1 §3.2.1, objects are forbidden as patch values.
  // The right error code is INVALID_VALUE (recoverable, path-scoped),
  // not INTERNAL — see ERROR-CODES.md §1.4 + LSDP-1.md §3.4.1.
  throw new LumencastError({
    code: "INVALID_VALUE",
    message: `${label}: objects are forbidden in patch values, push leaf-grain instead`,
    recoverable: true,
    ...(path !== undefined ? { path } : {}),
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function optionalTs(o: Record<string, unknown>): { ts?: string } {
  if (typeof o["ts"] === "string") return { ts: o["ts"] };
  return {};
}

function protocolError(message: string): LumencastError {
  return new LumencastError({ code: "INTERNAL", message, recoverable: false });
}
