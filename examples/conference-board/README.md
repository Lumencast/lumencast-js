# conference-board

Non-broadcast Lumencast demo: a live conference dashboard with Q&A counts and vote totals, driven by `@lumencast/server`. Unlike `basic-scoreboard` which uses the dev mock, this example stands up the production-shaped server.

## Run

```bash
pnpm install
pnpm --filter @lumencast/example-conference-board start
```

Connect a runtime against the printed `wsUrl` (see `examples/basic-scoreboard/README.md` for HTML scaffolding).

## What it shows

- `@lumencast/server` is the production-shaped Node kit (auth hook, bundle provider, scene with `update()`).
- The `authenticate` hook accepts `token === "operator"` as `operator` role; everything else is `viewer`.
- `scene.update({...})` pushes a delta to every subscriber of that scene.
- The shape `{ path: value, ... }` is sugar over `[{ path, value }, ...]` — both work.
