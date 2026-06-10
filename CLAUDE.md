# lumencast-js — projet CLAUDE.md

@../../docs/rules/git.md
@../../docs/rules/security.md
@../../docs/rules/agents.md
@../agents/\_shared/architecture.md
@../agents/\_shared/conventions.md
@../agents/\_shared/deploy.md
@../agents/\_shared/projects.md

## Description

`lumencast-js` est le SDK TypeScript canonique de Lumencast. Le repo est un **monorepo pnpm** qui publie quatre paquets sous `@lumencast/*` :

- `@lumencast/protocol` — pure LSDP/1 (envelope, codec, sequence, leaf-path, errors, types)
- `@lumencast/runtime` — runtime browser (`mount()`, transport, store leaf-grain, render LSML, animations, overlays)
- `@lumencast/server` — kit serveur Node (HTTP+WS, scene, store, adapters, auth hooks)
- `@lumencast/dev-server` — mock LSDP/1 + control plane `/__mock/*`

Le SDK est bootstrappé depuis `ZabLaboratory/Solar` v0.1.1 puis re-aligné au protocole LSDP/1 final (le wire format Solar diffère de LSDP/1 — adaptation requise sur transport/codec/sequence/types ; render/animate/overlay/state/modes restent verbatim).

## Stack

- **Runtime** : Node ≥ 22 (build-time only — packages browser tournent dans le navigateur)
- **Package manager** : pnpm ≥ 10 (workspaces)
- **Language** : TypeScript 5.7 strict (`noUncheckedIndexedAccess` on)
- **UI (runtime)** : React 19 + `@preact/signals-react` (one signal per leaf path)
- **Animation (runtime)** : Framer Motion 12 + thin `<Crossfade>`
- **Build** : Vite 6 library mode (runtime) + `tsc -b` project references partout
- **Test** : Vitest (unit) + Playwright (E2E sur `@lumencast/dev-server`)
- **Distribution** : npm publish manuel jusqu'à stabilisation du release flow

## Setup local

```bash
nvm use && corepack enable
pnpm install
pnpm build
pnpm test
```

Voir `CONTRIBUTING.md` pour les commandes complètes.

## Conventions spécifiques

- **Source canonique du protocole** : `lumencast-protocol/spec/LSDP-1.md` (et `LSML-1.md`, `RUNTIME-API.md`, `PERFORMANCE.md`, `ERROR-CODES.md`). Aucune divergence d'identifiants ou de sémantique avec ces specs.
- **Renommages depuis Solar** (jamais réintroduire les anciens noms) :
  - `orionUrl` → `serverUrl`
  - `Solar*` (identifiers, comments, docs) → `Lumencast*`
  - `LumenError`/`SolarError` → `LumencastError`
  - `LumenHandle`/`SolarHandle` → `LumencastHandle`
  - `mock-orion` → `dev-server`
  - imports `@zablab/solar` → `@lumencast/runtime`
- **Public surface** stable : `mount()` + types ré-exportés depuis `@lumencast/runtime/index`. Tout changement breaking bumpe le major du paquet.
- **Reactivity = leaf-grain** — un patch LSDP = un signal mis à jour = re-render uniquement des composants qui lisent ce signal. Pas de réconciliation custom.
- **GPU-only animations** — primitives n'animent que `transform`, `opacity`, `filter`. Animer `width`/`height`/`top`/`left` est rejeté (vu dans LSML §6). `bindAnimate` est implémenté (ADR 001 §3.3, #45) — coalescing par frame, spring velocity-carry, sRGB color interpolation.
- **Tree-shake par mode au build** — `broadcast` < `control` < `test`. Le code overlay n'apparaît pas dans le bundle `broadcast`. CI vérifie le budget.
- **Pas de logs en `broadcast`** — aucun chrome de plateforme. Erreurs remontent par `onError`. Les diagnostics anti-drop remontent par `onDiagnostic` (ADR 001 §3.4) — jamais `console.*` hors DEV.
- **Politique anti-drop active** — tout champ spec'd LSML non honoré produit un diagnostic `{ nodeId, field, reason }` (jamais la valeur — Bastion R9). `CompileOptions.strict: true` convertit les warns en throw. Voir `PRIMITIVE_PROP_ALLOWLIST` (runtime) et `onWarn`/`CompileDiagnostic` (compiler).
- **Caps sécurité** — `pathData`/`paths[].data` : allowlist SVG `d`, 8 KiB/subpath, cap commandes (RC#10). Valeurs couleur/filter : parser strict `parseCssColor`, regex ancrées, rejet de `url(`/`;`/`}` (RC#11). Filtres clampés au lowering : `blur` ≤ 100 px, `brightness` ≤ 4 (R8). Profils authoring `x-<v>.authoring/<maj>` ignorés sans rejet (segment terminal exact — RC#14).
- **Capacités runtime rendues (ADR 001 phases A+B, 2026-06-10)** : paths vectoriels (`shape geometry:"path"`, subpaths multiples, `windingRule`), typo complète (`lineHeight`, `letterSpacing`, `textTransform`, `textDecoration`, `fontStyle`, `maxLines`), `clipsContent` (`overflow: hidden/visible`), `bindAnimate`, sRGB color interpolation.
- **Token-agnostic** — Lumencast ne valide jamais de token, transmet l'opaque string au server.

## Performance budgets

| Métrique                | Budget          | Mesure                               |
| ----------------------- | --------------- | ------------------------------------ |
| `mount()` → first paint | < 100 ms        | Playwright `performance.mark`        |
| Delta → DOM update p95  | ≤ 50 ms         | Playwright `performance.mark`        |
| Bundle gz `broadcast`   | ≤ 200 KiB       | `scripts/check-bundle-size.mjs` (CI) |
| Bundle gz `control`     | ≤ 280 KiB       | idem                                 |
| Bundle gz `test`        | ≤ 350 KiB       | idem                                 |
| Animation hot path      | 0 layout events | DevTools perf trace en E2E           |

## Test coverage

| Type                                   | Seuil                   | Mesure              |
| -------------------------------------- | ----------------------- | ------------------- |
| Public API surface (`mount`, types)    | 100 % option-validation | `vitest --coverage` |
| Transport (codec, sequence, reconnect) | 90 %                    | `vitest --coverage` |
| State (apply-snapshot, apply-delta)    | 90 %                    | `vitest --coverage` |
| Render primitives                      | 70 % DOM smoke          | Vitest + happy-dom  |
| Animation engine                       | empirique               | Playwright          |

## CI/CD

`.github/workflows/ci.yml` jobs (mirror du protocol repo, fused CI+Deploy ZabAuth pattern) :

- `lint`, `typecheck`, `test`, `e2e` (Playwright, job séparé), `build`
- `check:bundle`, `lockfile-check`, `secret-scan`
- `conformance` (rejoue les fixtures depuis le protocol repo)
- `codeowners-check`

Concurrency : cancel sur PR, no cancel sur main. Pas de deploy auto v0.1.x — npm publish manuel.

## Decisions

- **2026-05-03** — Monorepo pnpm (vs Turborepo). Simplicité workspace, lockfile unique. Décision tracée ci-dessous quand un ADR sera nécessaire.
- **2026-05-03** — TypeScript project references (`tsc -b`) pour l'orchestration build inter-package, Vite library mode pour le bundling browser final du runtime.
- **2026-05-03** — Le wire protocol Solar (with `since_sequence`, mono-patch `input`, `from/to_scene_id`) est **abandonné** au profit de LSDP/1 final. Réécriture ciblée de `transport/`, `codec`, `sequence`, `types` ; tout le reste (state, render, animate, overlay, modes) reste verbatim avec rebrand.
- **2026-06-10** — ADR 001 phases A+B livrées (PRs #36–#46) : dette d'implémentation LSML 1.1 remboursée, `bindAnimate` implémenté, politique anti-drop active, threat model Bastion intégré. Phase C gated sur RFC LSML 1.2 (`lumencast-protocol#34`). Voir `docs/adr/001-runtime-authoring-fidelity.md §7`.

## Source material

Solar v0.1.1 cloné dans `D:\Document\Lumencast\.work\Solar\` (hors git) — référence d'extraction. Lire `Solar/CLAUDE.md` pour le contexte de la base source.
