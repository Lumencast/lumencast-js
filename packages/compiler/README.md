# @lumencast/compiler

> LSML 1.0 → flat `RenderBundle` compiler. Authors write idiomatic LSML, the runtime gets the shape it expects.

## Why this exists

`@lumencast/runtime` consumes a flat compiled form (`RenderBundle` with a `bindings` map per node, primitive-specific prop names like `text.size`, `repeat` with template-as-only-child). The canonical authoring format (LSML 1.0, see [`spec/LSML-1.md`](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSML-1.md)) is more ergonomic — inline `bind: { value: "path" }`, CSS-style `style.fontSize`, `repeat.template`. This compiler bridges the two.

It also computes the canonical sha256 `scene_version` per LSML 1.0 §3 so authors can content-address their bundles deterministically.

## Install

```bash
pnpm add @lumencast/compiler
```

## Surface

```ts
import { compileBundle, hashBundle, type LSMLBundle } from "@lumencast/compiler";

const lsml: LSMLBundle = {
  lsml: "1.0",
  scene_id: "scoreboard",
  scene_version: "sha256:0".repeat(64), // placeholder — replace via hashBundle
  layout: {
    kind: "stack",
    direction: "vertical",
    gap: 16,
    children: [
      { kind: "text", style: { fontSize: 48, color: "#fff" }, bind: { value: "show.title" } },
      {
        kind: "repeat",
        scope: "p",
        bind: { items: "players" },
        template: {
          kind: "text",
          bind: { value: "{p}.name" },
        },
      },
    ],
  },
};

// 1. Stamp a deterministic scene_version
const hashed = await hashBundle(lsml);

// 2. Compile to the runtime's flat form
const bundle = compileBundle(hashed);
```

The output `bundle` is what you serve at `GET /lsdp/v1/scenes/<id>/bundle?v=<scene_version>`.

## What this v0.1 covers

- 8 primitives: stack, grid, frame, text, image, shape, media, repeat
- `bind: { value | src | items }` → `bindings` map
- `bindStyle` → bindings on style props
- LSML CSS-style names → Solar's primitive vocab (`fontSize → size`, `color → colour`, etc.)
- Layout vocabulary mapping (`align: "start" → "flex-start"`, etc.)
- `repeat.template` → `children: [template]`
- `animate.transition` (tween / spring) → `transitions` map on the relevant prop keys
- `operator_inputs` passthrough
- Canonical hashing per LSML 1.0 §3 via `hashBundle()`

## What this v0.1 doesn't cover

- Full schema validation (use `lumen validate` for that — forthcoming CLI)
- `i18n` table → runtime resolution (LSML 1.0 §12)
- Asset host allowlist enforcement
- A11y schema rules (LSML 1.0 §13)

## License

Apache 2.0 — see the repo root.
