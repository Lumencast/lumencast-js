# @lumencast/runtime

> Browser runtime for Lumencast — `mount()`, LSDP/1 transport, leaf-grain reactive store, LSML-compatible primitive renderer, animations, operator overlays.

This is the canonical TypeScript runtime. Hosts (browsers, OBS browser sources, CEF wrappers, embedded iframes, native shells via WebView) call a single function:

```ts
import { mount } from "@lumencast/runtime";

const handle = mount({
  target: document.getElementById("stage")!,
  serverUrl: "wss://example.com/lsdp/v1",
  token: "<jwt>",
  mode: "broadcast",
});
```

## Modes

| Mode        | What renders                                                      | Bundle ≤ (gz) |
| ----------- | ----------------------------------------------------------------- | ------------- |
| `broadcast` | Pure scene, no chrome                                             | 200 KiB       |
| `control`   | Scene + operator overlay (status pill, control panel)             | 280 KiB       |
| `test`      | Scene + control + test inspector (mock adapters, state inspector) | 350 KiB       |

The mode argument tree-shakes at build time — a `broadcast` mount never downloads the overlay or test code.

## Surface

```ts
export function mount(options: MountOptions): LumencastHandle;

interface MountOptions {
  target: HTMLElement;
  serverUrl: string;
  token: string | { fetch: () => Promise<string> };
  mode: "broadcast" | "control" | "test";
  testSession?: string;
  scene?: string;
  onStatus?: (s: "disconnected" | "connecting" | "live") => void;
  onError?: (e: LumencastError) => void;
  onMetric?: (m: LumencastMetric) => void;
}

interface LumencastHandle {
  setToken(token: string | TokenProvider): void;
  disconnect(): void;
}
```

Full contract: [Lumencast/lumencast-protocol/spec/RUNTIME-API.md](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/RUNTIME-API.md).

## Lifecycle

1. `mount()` validates options, opens the WebSocket (subprotocol `lsdp.v1`), sends `subscribe`.
2. Server replies `snapshot` → runtime fetches the bundle by `scene_version`, seeds the store, renders.
3. `delta` frames apply leaf-grain. Bound primitives re-render selectively.
4. `scene_changed` triggers a fresh snapshot + bundle fetch + crossfade.
5. `setToken()` opens a parallel WS, swaps atomically (no flicker).
6. `disconnect()` tears down WS + React root.

## Bundle format

The runtime consumes a flat, pre-compiled `RenderBundle` (see `src/render/bundle.ts`). The canonical _authoring_ format is LSML 1.0; a compiler step (`@lumencast/compiler`, forthcoming) will translate LSML 1.0 → `RenderBundle`.

## Performance budgets

| Metric                           | Budget    | Verified by                     |
| -------------------------------- | --------- | ------------------------------- |
| `mount()` → first paint          | < 100 ms  | Playwright `performance.mark`   |
| Delta → DOM update p95           | ≤ 50 ms   | Playwright `performance.mark`   |
| Bundle gz `broadcast`            | ≤ 200 KiB | `scripts/check-bundle-size.mjs` |
| Bundle gz `control`              | ≤ 280 KiB | same                            |
| Bundle gz `test`                 | ≤ 350 KiB | same                            |
| Animation hot-path layout events | 0         | DevTools perf trace             |

## License

Apache 2.0 — see the repo root.
