# @lumencast/dev-server

> Mock LSDP/1 server for tests — speaks the wire protocol, serves LSML bundles over HTTP, exposes a `/__mock/*` control plane for Playwright.

This package is **not** a production server kit (that's `@lumencast/server`). It exists so any adopter writing tests against `@lumencast/runtime` can boot a real WebSocket end-to-end without standing up infrastructure.

## Install

```bash
pnpm add -D @lumencast/dev-server
```

## Surface

```ts
import { startDevServer } from "@lumencast/dev-server";

const server = await startDevServer({
  port: 0, // 0 = random
  initialSceneId: "main-stage",
  initialSceneVersion: "sha256:abc...",
  initialBundle: {
    /* LSML 1.0 JSON */
  },
  initialState: { "show.title": "Live", "players.0.score": 0 },
});

console.log(server.wsUrl); // ws://127.0.0.1:NNNNN/lsdp/v1
console.log(server.httpUrl); // http://127.0.0.1:NNNNN

server.pushDelta([{ path: "players.0.score", value: 1 }]);

server.switchScene({
  sceneId: "intermission",
  sceneVersion: "sha256:def...",
  bundle: {
    /* ... */
  },
  state: { "show.title": "Back soon" },
});

await server.close();
```

## Control plane (HTTP, used by Playwright)

| Method | URL                                       | Body                                       |
| ------ | ----------------------------------------- | ------------------------------------------ |
| `POST` | `/__mock/delta`                           | `{ patches: Patch[] }`                     |
| `POST` | `/__mock/scene-changed`                   | `{ sceneId, sceneVersion, bundle, state }` |
| `POST` | `/__mock/register-bundle`                 | LSML bundle JSON                           |
| `POST` | `/__mock/reset`                           | (none) — restore initial state             |
| `GET`  | `/lsdp/v1/health`                         | health probe                               |
| `GET`  | `/lsdp/v1/scenes/:id/bundle?v=sha256:...` | LSML bundle by version                     |

## What this does NOT do

- No token validation. Any subscribe is accepted.
- No rate limiting. No backpressure.
- No persistence. State lives in process memory.
- No multi-tenant. One initial scene at a time.

For production needs, use `@lumencast/server`.

## License

Apache 2.0 — see the repo root.
