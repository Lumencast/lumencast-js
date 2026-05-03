// Public surface of @lumencast/server.

export { startServer, type ServerConfig, type ServerHandle } from "./server.js";
export { createScene, type Scene, type SceneInit } from "./scene.js";
export { LeafStore, type LeafStoreListener } from "./store.js";
export {
  defaultAuthenticate,
  canWritePath,
  StaticTokens,
  type Authenticate,
  type AuthDecision,
  type Role,
} from "./auth.js";
export { startHttpPoll, type HttpPollOptions } from "./adapters/http-poll.js";
export {
  startTestControl,
  installTokens,
  type TestControlOptions,
  type TestControlHandle,
} from "./test-control.js";
