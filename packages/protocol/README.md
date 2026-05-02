# @lumencast/protocol

> Pure LSDP/1 — envelope, codec, sequence tracker, leaf-path utilities, error taxonomy, types.

This package has **no IO**. No WebSocket, no fetch, no DOM. It's the protocol primitives that `@lumencast/runtime`, `@lumencast/server`, and `@lumencast/dev-server` all depend on.

The full LSDP/1 specification lives at [Lumencast/lumencast-protocol/spec/LSDP-1.md](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSDP-1.md).

## Install

```bash
pnpm add @lumencast/protocol
```

## Surface

```ts
import {
  // Envelope encode/decode
  encodeFrame,
  decodeFrame,
  // Sequence tracking
  SequenceTracker,
  // LeafPath utilities
  parseLeafPath,
  formatLeafPath,
  substituteScope,
  // Errors
  LumencastError,
  isProtocolErrorCode,
  // Types
  type ServerFrame,
  type ClientFrame,
  type SnapshotFrame,
  type DeltaFrame,
  type SceneChangedFrame,
  type ErrorFrame,
  type SubscribeFrame,
  type InputFrame,
  type LeafPath,
  type ErrorCode,
  PROTOCOL_VERSION,
  WS_SUBPROTOCOL,
} from "@lumencast/protocol";
```

## Versioning

The package version tracks the LSDP **major** version. `@lumencast/protocol@0.x` and `1.x` implement LSDP/1; LSDP/2 would land in `@lumencast/protocol@2.x`.

Forward-compatible additions (new optional envelope fields, new minor frame types) are minor bumps within the same major.

## License

Apache 2.0 — see the repo root.
