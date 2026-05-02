# Contributing to lumencast-js

Thanks for considering a contribution.

This repository ships the canonical **TypeScript** implementation of Lumencast — protocol, runtime, server kit, dev server. Governance for the wire protocol (LSDP/1) and the scene format (LSML 1.0) lives in the [protocol repo](https://github.com/Lumencast/lumencast-protocol). Read its [`CONTRIBUTING.md`](https://github.com/Lumencast/lumencast-protocol/blob/main/CONTRIBUTING.md) and [`GOVERNANCE.md`](https://github.com/Lumencast/lumencast-protocol/blob/main/GOVERNANCE.md) before proposing protocol-touching changes.

This file documents what is **specific to the TypeScript SDK**.

## Setup

```bash
# Node ≥ 22, pnpm ≥ 10
nvm use            # picks .nvmrc
corepack enable    # enables pnpm shipped with Node
pnpm install
```

## Day-to-day commands

```bash
pnpm build              # builds every package via TS project refs
pnpm typecheck          # tsc -b across the workspace
pnpm lint               # ESLint flat config, max 0 warnings
pnpm format             # Prettier write
pnpm format:check       # Prettier verify (used in CI)
pnpm test               # Vitest unit tests across packages
pnpm test:e2e           # Playwright (runtime package only)
pnpm check:bundle       # bundle-budget check on @lumencast/runtime
pnpm conformance        # rejoue les fixtures conformance
```

## Pull requests

- One feature or fix per PR. Keep the diff focused.
- Branch naming : `feature/*`, `fix/*`, `refactor/*`, `chore/*`, `docs/*`.
- Squash-merge only. The PR title becomes the merge commit subject.
- Required CI gates (mirror the protocol repo) :
  - `lint` — 0 warnings
  - `typecheck` — strict TS 5.7
  - `test` — Vitest, all packages
  - `e2e` — Playwright, separate job
  - `build` — every package builds
  - `check:bundle` — runtime modes within budget
  - `lockfile-check` — `pnpm-lock.yaml` not drifted
  - `secret-scan` — no leaked secrets
  - `conformance` — golden fixtures pass
  - `codeowners-check` — CODEOWNERS present and parseable
- All commits **MUST** be GPG/SSH signed.
- Code, commits, branches, PR descriptions in English. Spec citations and longer rationale paragraphs may be in either language.

## Code conventions

- TypeScript 5.7 strict. `noUncheckedIndexedAccess` on. No `any` unless justified by an inline comment.
- ESM only. No CJS interop except where a downstream Node ecosystem requires it (server adapters).
- Public APIs go in each package's `src/index.ts`. Internal helpers live under `src/internal/`.
- Renames from Solar : `orionUrl` → `serverUrl`, `Solar*` → `Lumencast*`, `LumenError` → `LumencastError`. Do not reintroduce Solar identifiers.

## Tests

- **Unit (Vitest)** — every package owns its `tests/`. Coverage goals : 90 % on transport/state/protocol code, 70 % DOM smoke on render primitives.
- **E2E (Playwright)** — `packages/runtime/tests/e2e/` boots `@lumencast/dev-server` and drives `mount()` against it.
- **Conformance** — the protocol package replays fixtures from `lumencast-protocol/conformance/`.

Always add a regression test alongside a bug fix.

## Security

Never commit secrets. The repo's `secret-scan` CI job blocks pushes that drop credentials. For coordinated disclosure see [`SECURITY.md`](SECURITY.md).

## Code of Conduct

This project adopts the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Reports go to the same enforcement channel as the protocol repo.

## License

By contributing you agree to license your work under Apache 2.0 (see [`LICENSE`](LICENSE)).
