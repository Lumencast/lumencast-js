# lumencast-js

> TypeScript SDK monorepo for **Lumencast** — the missing standard for server-driven displays.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Spec: LSDP/1](https://img.shields.io/badge/Protocol-LSDP%2F1-orange.svg)](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSDP-1.md)
[![Format: LSML 1.0](https://img.shields.io/badge/Format-LSML%201.0-purple.svg)](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSML-1.md)

This repo bundles four packages under the `@lumencast/*` npm scope :

| Package                                        | What it does                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [`@lumencast/protocol`](packages/protocol)     | Pure protocol code — LSDP/1 envelope, codec, sequence tracker, leaf-path utilities, error taxonomy, types |
| [`@lumencast/runtime`](packages/runtime)       | Browser runtime — `mount()`, transport, leaf-grain store, render of LSML primitives, animations, overlays |
| [`@lumencast/server`](packages/server)         | Node server kit — HTTP+WS server, scene/store/adapter abstractions, token-agnostic auth hooks             |
| [`@lumencast/dev-server`](packages/dev-server) | Mock LSDP/1 server with `/__mock/*` control plane — useful for any adopter writing tests                  |

## Quickstart

```bash
pnpm install
pnpm build
pnpm test
```

A full hello-world lives in [`examples/basic-scoreboard`](examples/basic-scoreboard) — boots `@lumencast/dev-server`, mounts `@lumencast/runtime`, sends a couple of deltas.

```ts
import { mount } from "@lumencast/runtime";

const handle = mount({
  target: document.getElementById("stage")!,
  serverUrl: "wss://example.com/lumencast/v1",
  token: "<jwt>",
  mode: "broadcast",
});

// later, when the operator's token rotates :
handle.setToken("<new-jwt>");

// teardown :
handle.disconnect();
```

## Repo layout

```
lumencast-js/
├── packages/
│   ├── protocol/         @lumencast/protocol     — pure LSDP/1
│   ├── runtime/          @lumencast/runtime      — browser, mount() + render
│   ├── server/           @lumencast/server       — Node server kit
│   └── dev-server/       @lumencast/dev-server   — mock for tests
├── examples/
│   ├── basic-scoreboard/                         — 5-minute hello world
│   └── conference-board/                         — vote queue + Q&A counts
├── pnpm-workspace.yaml
├── package.json                                  — workspace root
├── tsconfig.base.json                            — strict TS 5.7 base
├── tsconfig.json                                 — project references root
├── eslint.config.mjs                             — flat ESLint
└── .prettierrc.json
```

## Package matrix

| Mode        | Bundle ≤ (gz) | Includes                         |
| ----------- | ------------- | -------------------------------- |
| `broadcast` | 200 KiB       | transport + state + render       |
| `control`   | 280 KiB       | + operator overlay               |
| `test`      | 350 KiB       | + test inspector + mock plumbing |

Vite library-mode builds three entry points so hosts only ship what they use.

## Spec & conformance

The wire protocol (LSDP/1), the scene format (LSML 1.0), the error code taxonomy and the conformance fixtures live in [Lumencast/lumencast-protocol](https://github.com/Lumencast/lumencast-protocol). This SDK is the canonical TypeScript implementation.

`pnpm conformance` runs the protocol package's harness against the fixtures.

## Status

- **Status** : `0.1.0` — pre-alpha. Spec is draft; SDK extracts from [`Solar` v0.1.1](https://github.com/ZabLaboratory/Solar) and re-aligns to LSDP/1.
- **Distribution** : npm publish manual until release flow stabilises (no auto-deploy in `0.1.x`).

## Relationship to Solar

This SDK was bootstrapped from `ZabLaboratory/Solar` v0.1.1 (Apache 2.0). The Solar internal protocol has been replaced with the formal LSDP/1 wire protocol; identifiers re-namespaced to `@lumencast/*`; rendering primitives kept verbatim where they were already protocol-agnostic. Solar continues to live under Zablab as their broadcast runtime — Zablab plans to consume `@lumencast/runtime` once this SDK matures.

See [`NOTICE`](NOTICE) for attribution details.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Governance and the RFC process for protocol/schema changes live in the [protocol repo](https://github.com/Lumencast/lumencast-protocol/blob/main/GOVERNANCE.md).

## License

Apache License 2.0 — see [`LICENSE`](LICENSE).
