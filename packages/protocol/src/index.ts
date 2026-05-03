// Public surface of @lumencast/protocol.

export {
  PROTOCOL_VERSION,
  WS_SUBPROTOCOL,
  WS_SUBPROTOCOL_V1_1,
  WS_SUBPROTOCOLS,
  type Cause,
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
  type SceneTransition,
  type SceneVersion,
  type ServerFrame,
  type SessionId,
  type SnapshotFrame,
  type SubscribeFrame,
  type TransitionSpec,
  type UnsubscribeFrame,
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
  unsubscribe,
  type SnapshotInit,
  type DeltaInit,
  type SceneChangedInit,
  type ErrorInit,
  type SubscribeInit,
  type InputInit,
} from "./envelope.js";
