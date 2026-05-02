# @lumencast/server

> Node server kit for LSDP/1 — HTTP + WebSocket, scene composition, server-side leaf store, adapters, token-agnostic auth hooks.

This is the production-grade counterpart of `@lumencast/dev-server`. It's the package you build a real Lumencast backend on top of in Node.

## Install

```bash
pnpm add @lumencast/server
```

## Quickstart

```ts
import { createScene, startServer } from "@lumencast/server";

const scene = createScene({
  sceneId: "main-stage",
  sceneVersion: "sha256:abc...",
  initialState: { "show.title": "Live", "players.0.score": 0 },
});

const server = await startServer({
  port: 8080,
  bundleProvider: async (sceneVersion) => {
    // load LSML JSON from disk / DB / S3
    return loadBundle(sceneVersion);
  },
  authenticate: async (token) => {
    // return a role, or throw an LumencastError with AUTH_DENIED
    return token === "operator" ? { role: "operator" } : { role: "viewer" };
  },
  scene,
});

scene.update({ "players.0.score": 1 }); // pushes a delta to subscribers
```

## Surface

```ts
export { startServer, type ServerConfig, type ServerHandle } from "@lumencast/server";
export { createScene, type Scene } from "@lumencast/server";
export { LeafStore, type LeafStoreEvent } from "@lumencast/server";
```

## Auth model

`authenticate` is the only auth hook. It runs on every `subscribe` frame, gets the opaque token, and returns a `{ role }` decision (or throws `LumencastError({ code: "AUTH_DENIED" })`). The kit enforces the role per LSDP/1 §9 — viewers can never `input`, `__inputs.*` is restricted to operator/service, etc.

## What this v0.1 ships

- Single-scene HTTP+WS server (one active scene at a time).
- `Scene` class with `update(patches)` → broadcasts a `delta`.
- `LeafStore` event emitter for adapters to listen on.
- Bundle fetch via a user-supplied `bundleProvider`.
- Pluggable `authenticate` hook.

## What this v0.1 doesn't ship (yet)

- Multi-scene routing (one server, many scenes selected via `subscribe.scene`).
- Pre-built adapters beyond `http_poll` and `ws_subscribe` skeletons.
- Backpressure / per-token rate-limiting (track on the gateway in front).
- Snapshot persistence — the snapshot is rebuilt from in-memory state.

## License

Apache 2.0 — see the repo root.
