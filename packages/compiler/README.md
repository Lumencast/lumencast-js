# @lumencast/compiler

> LSML 1.0 / 1.1 → flat `RenderBundle` compiler. Authors write idiomatic LSML, the runtime gets the shape it expects.

## Why this exists

`@lumencast/runtime` consumes a flat compiled form (`RenderBundle` with a `bindings` map per node, primitive-specific prop names like `text.size`, `repeat` with template-as-only-child). The canonical authoring format (LSML 1.0, see [`spec/LSML-1.md`](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSML-1.md)) is more ergonomic — inline `bind: { value: "path" }`, CSS-style `style.fontSize`, `repeat.template`. This compiler bridges the two.

It also computes the canonical sha256 `scene_version` per LSML §3 so authors can content-address their bundles deterministically.

## Install

```bash
pnpm add @lumencast/compiler
```

## Surface

```ts
import {
  compileBundle,
  hashBundle,
  validatePathData,
  type LSMLBundle,
  type CompileOptions,
  type CompileDiagnostic,
} from "@lumencast/compiler";

const lsml: LSMLBundle = {
  lsml: "1.1",
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
const opts: CompileOptions = {
  strict: false, // true → throw on any warn (CI/authoring tools)
  onWarn: (msg, diag: CompileDiagnostic) => {
    // diag.nodeId, diag.field, diag.reason — never the offending value (R9)
    console.warn(msg);
  },
};
const bundle = compileBundle(hashed, opts);
```

The output `bundle` is what you serve at `GET /lsdp/v1/scenes/<id>/bundle?v=<scene_version>`.

## What this covers (LSML 1.0 + 1.1, ADR 001 phases A+B)

- 9 primitives: stack, grid, frame, text, image, shape, media, repeat, instance
- `bind: { value | src | items }` → `bindings` map; `bindStyle` → bindings on style props
- LSML CSS-style names → runtime primitive vocab (`fontSize → size`, `color → colour`, etc.)
- Layout vocabulary mapping (`align: "start" → "flex-start"`, etc.)
- `repeat.template` → `children: [template]`
- `animate.transition` (tween / spring with `mass`) → `transitions` map; `animate.from.filter` lowered and clamped
- `bindAnimate` §6.3 → `animateBindings` map; keys validated against animatable props (throw on invalid key)
- `fills[]`, `strokes[]` per LSML 1.1
- `paths[]` / `pathData` — validated via `validatePathData()` (strict SVG `d` allowlist, 8 KiB/subpath cap, command cap)
- `clipsContent` forwarded on frames
- `keyframes` + `stagger_ms` lowered to runtime keyframe shape
- `scale: [sx, sy]` per-axis
- `cornerRadius` → `radius` mismatch corrected
- `filter` values clamped at lowering (`blur` ≤ 100 px, `brightness` ≤ 4, negatives rejected — R8)
- `profiles[]` forwarded into the `RenderBundle` (authoring profiles treated as advisory per §17.5.1)
- Anti-silent-drop: every spec'd-but-unsupported field calls `onWarn` with `{ nodeId, field, reason }` (never the value); `strict: true` throws
- Canonical hashing per LSML §3 via `hashBundle()`

### `validatePathData(d, nodeId, field)`

Standalone validator for SVG `d` strings. Allowlists commands `MmLlHhVvCcSsQqTtAaZz` + numbers;
rejects `url(`, `data:`, `<`, `&`; enforces the byte and command caps. Throws on invalid input.
Available independently for tooling that validates paths outside `compileBundle`.

## What this doesn't cover

- Full schema validation (use `lumen validate` — forthcoming CLI)
- `i18n` table → runtime resolution (LSML §12)
- Asset host allowlist enforcement
- A11y schema rules (LSML §13)
- Phase C fields (`effects[]`, `blendMode`, per-corner `cornerRadius`, `strokes[]` advanced, `angular-gradient`/`diamond-gradient`, `mask`) — gated on RFC LSML 1.2

## License

Apache 2.0 — see the repo root.
