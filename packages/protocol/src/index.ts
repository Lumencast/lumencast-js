// Public surface of @lumencast/protocol.

export {
  PROTOCOL_VERSION,
  WS_SUBPROTOCOL,
  type ClientFrame,
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
  type ServerFrame,
  type SessionId,
  type SnapshotFrame,
  type SubscribeFrame,
} from "./types.js";

export { LumencastError, isProtocolErrorCode, type LumencastErrorInit } from "./errors.js";

export { encodeFrame, decodeServerFrame, decodeClientFrame } from "./codec.js";

export { SequenceTracker, type SequenceObservation } from "./sequence.js";

export {
  RESERVED_NAMESPACES,
  type ReservedNamespace,
  parseLeafPath,
  formatLeafPath,
  isReservedPath,
  isUnknownReservedPath,
  substituteScope,
} from "./leaf-path.js";

export {
  snapshot,
  delta,
  sceneChanged,
  errorFrame,
  pong,
  subscribe,
  input,
  ping,
  type SnapshotInit,
  type DeltaInit,
  type SceneChangedInit,
  type ErrorInit,
  type SubscribeInit,
} from "./envelope.js";
