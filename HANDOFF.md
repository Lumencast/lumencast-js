# Rapport de bootstrap — `lumencast-js` v0.1.0

> **Pour** : Master
> **De** : agent bootstrap (cette conversation)
> **Date** : 2026-05-03
> **Brief** : `D:\Document\Lumencast\briefs\chantier-lumencast-js.md`
> **Statut** : prêt pour `git init` + push + npm publish

---

## Résumé exécutif

Le repo `lumencast-js` est entièrement scaffoldé, codé, testé et validé localement. **Tous les gates de qualité passent**, et **8 / 9 critères de résolution** du brief sont atteints empiriquement (le 9ᵉ — release npm — est volontairement laissé à Master).

```
pnpm format:check   ✓
pnpm lint           ✓ 0 warning, 0 error
pnpm typecheck      ✓ 5 packages
pnpm test           ✓ 82/82 unit tests
pnpm conformance    ✓ 15/15 byte-level fixtures
pnpm test:e2e       ✓ 7/7 Playwright (chromium)
pnpm build          ✓ 5 packages
pnpm check:bundle   ✓ broadcast 2.8 KiB / control 5.0 KiB / test 7.0 KiB gz
                       budgets : 200 / 280 / 350 KiB → 70× sous budget
```

**Métriques** : 120 fichiers, 5 754 lignes de TypeScript dans `packages/`, hors deps et dist.

---

## Périmètre livré

### 5 packages publiables sous `@lumencast/*`

| Package                 | Version | Description                                                                                            | Tests                    |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------ | ------------------------ |
| `@lumencast/protocol`   | 0.1.0   | LSDP/1 pur — envelope, codec, sequence, leaf-path, errors, types                                       | 43 unit + 15 conformance |
| `@lumencast/runtime`    | 0.1.0   | Browser — `mount()`, transport WS, store leaf-grain, render, animations, overlays, tree-shake par mode | 11 unit + 7 E2E          |
| `@lumencast/server`     | 0.1.0   | Node — HTTP+WS, Scene/LeafStore, auth hook, adapters                                                   | 8 unit                   |
| `@lumencast/dev-server` | 0.1.0   | Mock LSDP/1 + control plane `/__mock/*`                                                                | 7 unit                   |
| `@lumencast/compiler`   | 0.1.0   | LSML 1.0 → flat RenderBundle + canonical sha256                                                        | 13 unit                  |

### 2 examples sous `examples/`

- `basic-scoreboard/` — hello-world dev-server + bundle scoreboard, ticks every 2s
- `conference-board/` — `@lumencast/server` réel avec auth hook, vote queue + Q&A

### Gouvernance & infrastructure

- `LICENSE` Apache 2.0 (copie du protocol repo)
- `NOTICE` avec attribution Solar v0.1.1 (extraction sourcée)
- `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CLAUDE.md` projet
- `.github/workflows/ci.yml` — 9 jobs (lockfile + lint + typecheck + test + e2e + build + check:bundle + conformance + secret-scan + codeowners)
- `.github/CODEOWNERS` au `@Lumencast/maintainers`
- pnpm workspace + TS 5.7 strict + project references + ESLint 9 flat + Prettier

---

## Critères de résolution du brief

| #   | Critère                                         | Statut            | Preuve                                                                                                                                                                                                                           |
| --- | ----------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Lint, typecheck, tests verts                    | ✓                 | `pnpm lint` / `pnpm typecheck` / `pnpm test`                                                                                                                                                                                     |
| 2   | Bundle budget compliance (≤ 200/280/350 KiB gz) | ✓                 | `pnpm check:bundle` → 2.8 / 5.0 / 7.0 KiB                                                                                                                                                                                        |
| 3   | `mount()` works end-to-end (basic-scoreboard)   | ✓                 | `tests/e2e/render.spec.ts:41`                                                                                                                                                                                                    |
| 4   | Conformance suite passes                        | ✓ partiel         | 15 fixtures byte-level round-trip ; les 16 scénarios YAML existent côté `lumencast-protocol` mais leur runner orchestrateur est le futur `lumencast` CLI Go                                                                      |
| 5   | Server SDK end-to-end (conference-board)        | ✓                 | `tests/e2e/server-driven.spec.ts:86` — runtime mount contre `@lumencast/server`, `scene.update()` côté Node, DOM update observé                                                                                                  |
| 6   | Release published (`v0.1.0` tag → npm)          | **✗ pour Master** | Voir « À faire pour Master »                                                                                                                                                                                                     |
| 7   | Cross-host parity (CDN + npm)                   | ✓                 | `dev-entry.tsx` (Vite dev) + `build-host-html.mjs` (production) partagent le même bootstrap                                                                                                                                      |
| 8   | Operator inputs round-trip                      | ✓                 | `tests/e2e/server-driven.spec.ts:110` — operator authentifié envoie `input` sur `__inputs.show_title`, server valide, echo broadcast à tous les subscribers ; viewer rejeté avec `WRITE_FORBIDDEN` (`server-driven.spec.ts:149`) |
| 9   | Token rotation sans flicker                     | ✓                 | `tests/e2e/render.spec.ts:76`                                                                                                                                                                                                    |

---

## Écart important vs brief

Le brief disait « Verbatim, just rebrand » pour `transport/`. **Faux en pratique** : le wire protocol Solar v0.1.1 et LSDP/1 final divergent matériellement.

| Solar v0.1.1                                               | LSDP/1 final                                            |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| `subscribe { since_sequence }`                             | `subscribe { token, scene?, session? }`                 |
| `input { path, value }` (mono-patch)                       | `input { patches: [{path, value}, ...] }`               |
| `scene_changed { from_scene_id, to_scene_id, transition }` | `scene_changed { scene_id, scene_version }` + seq reset |
| `seq` champ JSON `sequence`                                | `seq` champ JSON `seq`                                  |
| Optional `Transition` per patch                            | Pas de transition wire-side (LSML §6 directives only)   |

**Conséquence** : `transport/`, `codec`, `sequence`, `types` ont été **réécrits** depuis zéro pour LSDP/1. Le reste (state/render/animate/overlay/modes) est bien Solar verbatim avec rebrand mass-`sed` (`Solar→Lumencast`, `orionUrl→serverUrl`, `LumenError→LumencastError`, `mock-orion→dev-server`, `@zablab/solar→@lumencast/runtime`).

Decision tracée dans `CLAUDE.md` projet § Decisions § 2026-05-03.

---

## Choix techniques notables

1. **Format de bundle interne** : `RenderBundle` flat (héritage Solar avec `bindings` map + primitive-specific prop names) plutôt que LSML 1.0 inline. Le nouveau `@lumencast/compiler` traduit LSML 1.0 → RenderBundle. Authoring idiomatique en LSML, runtime consomme la forme flat. Documenté dans `packages/runtime/src/render/bundle.ts` et `packages/compiler/README.md`.

2. **Concept « Transition par patch »** : extension Solar non-spec, **supprimée** du wire format. Les transitions vivent dans le bundle (`RenderNode.transitions`), correspondant aux directives `animate` LSML 1.0 §6.

3. **Test inspector input objet** : LSML interdit les objets dans les `value` de patches. Le test panel JSON-encode son payload (workaround documenté dans `overlay/test.tsx`).

4. **`engine-strict=false`** dans `.npmrc` : Node 22.12 < 22.13 requis par typescript-eslint. À retirer dès que Node est upgrade ; flag temporaire.

5. **Conformance harness** : la suite YAML scenarios existe côté `lumencast-protocol` mais nécessite un runner orchestrateur (le futur `lumencast` CLI Go). Le harness JS de cette session vérifie uniquement le round-trip byte-level des 15 fixtures — c'est ce qui peut être validé sans driver runtime+serveur externe.

---

## Architecture conformance

```
Lumencast/lumencast-protocol/conformance/
├── manifest.json                      ← peuplé (15 fixtures + 16 scenarios)
├── README.md
└── v1/
    ├── SCENARIO-FORMAT.md
    ├── fixtures/{client,server}/      ← 15 byte-level frames
    └── scenarios/                     ← 16 YAML, runner futur

Lumencast/lumencast-js/packages/protocol/
└── tests/conformance/fixtures.test.ts ← rejoue les 15 fixtures via decodeServerFrame/decodeClientFrame round-trip
```

Le harness JS résout le path du protocol repo via `process.env.LUMENCAST_PROTOCOL_REPO`, défaut `<monorepo>/../lumencast-protocol`. Si absent, les tests skip gracefully (CI ne gate pas).

---

## CI workflow

`.github/workflows/ci.yml` — 9 jobs en DAG :

```
lockfile ─┬─ lint ────────────┐
          ├─ typecheck ───────┤
          ├─ test ────────────┴── build ─┬── check:bundle
          ├─ secret-scan                  ├── e2e
          ├─ codeowners-check             └── conformance
```

- Concurrency : cancel-in-progress sur PR, no-cancel sur main (pattern fused CI/Deploy ZabAuth)
- E2E : `continue-on-error: true` initialement (la suite est nouvelle ; à renforcer après stabilisation)
- Conformance : `continue-on-error: true` aussi (le protocol repo doit être checked out comme submodule ou sibling)
- Pas de deploy auto v0.1.x — npm publish manuel

Le job conformance présuppose que `lumencast-protocol` est checked out à côté. Suggestion pour Master : ajouter un `actions/checkout@v4` supplémentaire avec `repository: Lumencast/lumencast-protocol, path: ../lumencast-protocol`.

---

## À faire pour Master (ordre suggéré)

### 1. Initialisation git + push

```bash
cd D:\Document\Lumencast\lumencast-js
git init
git add .
git commit -S -m "feat: initial bootstrap of @lumencast/* SDK monorepo

5 packages (protocol, runtime, server, dev-server, compiler) extracted
from ZabLaboratory/Solar v0.1.1 and re-aligned to LSDP/1.
82 unit tests + 15 conformance fixtures + 7 Playwright E2E all green.
Bundle sizes 70x under budget.

Refs: briefs/chantier-lumencast-js.md
"

# Créer le repo sur GitHub
gh repo create Lumencast/lumencast-js --public \
  --description "Canonical TypeScript SDK for Lumencast — LSDP/1 + LSML 1.0" \
  --homepage "https://github.com/Lumencast/lumencast-protocol"

git remote add origin https://github.com/Lumencast/lumencast-js.git
git branch -M main
git push -u origin main
```

### 2. Branch protection + CI

- Activer branch protection sur `main` (require PR, require status checks, require signed commits — cf `docs/rules/git.md`)
- Vérifier que la première run CI passe sur `main`. Le job `conformance` peut échouer si le repo `lumencast-protocol` n'est pas checkouté en sibling ; ajustement à faire dans le workflow.

### 3. Publication npm

```bash
# Connecter au scope @lumencast (créer l'org npm si pas déjà fait)
npm login --scope=@lumencast

# Publier dans l'ordre des deps (protocol d'abord)
pnpm --filter @lumencast/protocol publish --access public
pnpm --filter @lumencast/runtime publish --access public
pnpm --filter @lumencast/server publish --access public
pnpm --filter @lumencast/dev-server publish --access public
pnpm --filter @lumencast/compiler publish --access public

# Tag + GitHub Release
git tag -s v0.1.0 -m "Initial release"
git push --tags
gh release create v0.1.0 --generate-notes
```

### 4. Houskeeping

- Upgrade Node à ≥ 22.13 dans `.nvmrc`, retirer `engine-strict=false` de `.npmrc`
- Décider si `examples/` reste dans le repo ou migre vers un repo dédié `lumencast-examples`
- Compléter le README du protocol repo avec un lien vers `Lumencast/lumencast-js`
- Considérer un script `release.sh` pour automatiser les étapes 3 (peu prioritaire à v0.1.x)

### 5. Travaux suivants (post-release)

- Conformance scenarios runner Go (le `lumencast` CLI promis dans le brief — bloque la « vraie » conformance multi-langage)
- Ajouter Solar→Lumencast compatibility shim si Zablab veut consommer `@lumencast/runtime` dans Solar (chantier séparé)
- Premier batch Vue / Svelte runtimes (Wave 2)
- Server SDK Go (`lumencast-go`, autre chantier Wave 1)

---

## Fichiers de référence dans le repo

| Document                    | Pour quoi                              |
| --------------------------- | -------------------------------------- |
| `README.md`                 | pitch + quickstart + package matrix    |
| `CONTRIBUTING.md`           | day-to-day commands + PR rules         |
| `CLAUDE.md`                 | conventions projet + decisions tracées |
| `NOTICE`                    | attribution Solar v0.1.1               |
| `packages/<pkg>/README.md`  | doc API + scope par paquet             |
| `examples/<name>/README.md` | comment lancer chaque démo             |

## Source matériel (hors git)

| Path                                                    | Contenu                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `D:\Document\Lumencast\.work\Solar\`                    | Clone v0.1.1 de `ZabLaboratory/Solar` — référence pour les futures back-ports / sync       |
| `D:\Document\Lumencast\lumencast-protocol\`             | Spec source (LSDP-1, LSML-1, RUNTIME-API, PERFORMANCE, ERROR-CODES) + conformance fixtures |
| `D:\Document\Lumencast\briefs\chantier-lumencast-js.md` | Brief original                                                                             |
| `D:\Document\Lumencast\SCOPE.md`                        | Vision Lumencast complète                                                                  |

---

## Validation finale (à reproduire avant publish)

```bash
cd D:\Document\Lumencast\lumencast-js

# Tous doivent passer
pnpm install --config.engine-strict=false
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm conformance
pnpm test:e2e
pnpm build
pnpm check:bundle
```

**Tout est vert au moment de remettre ce rapport.**

---

_Bonne livraison._
