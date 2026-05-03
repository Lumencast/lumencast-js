# Releasing

How to ship a new version of every `@lumencast/*` package to npm.

## Prerequisites (one-time)

1. **Claim the `@lumencast` scope on npm** — log in to [npmjs.com](https://www.npmjs.com/), Settings → Add Organization → name `lumencast` (free tier).
2. **Generate an Automation token** — npmjs.com → Settings → Access Tokens → New Granular Access Token. Type `Automation` (bypasses 2FA prompts in CI). Scope it to the `@lumencast` org with publish permission.
3. **Add `NPM_TOKEN` to the repo** — GitHub repo → Settings → Secrets and variables → Actions → New repository secret. Name `NPM_TOKEN`, paste the token from step 2.

## Cutting a release

We keep all `@lumencast/*` packages on the same version (single coordinated release line). The release workflow validates that every `package.json` matches the tag.

1. **Decide the version**. Bump per [semver](https://semver.org). Pre-1.0 we treat any change as `0.X.0` (minor) for the moment.

2. **Bump every `package.json`**. From the repo root :

   ```bash
   pnpm -r exec npm version <new-version> --no-git-tag-version
   ```

   Verify : `git diff packages/*/package.json` should show every package on the new version.

3. **Update the lockfile** :

   ```bash
   pnpm install --no-frozen-lockfile
   ```

4. **Commit and push to `main` via PR**. Title : `chore(release): vX.Y.Z`. Get it merged.

5. **Tag the merge commit** :

   ```bash
   git checkout main && git pull --ff-only
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

6. **Watch the workflow**. The `Release` workflow on the tag :
   - Validates every `package.json` version matches the tag
   - Builds + tests
   - Publishes the 7 packages to npm in dependency order, with provenance
   - Creates a GitHub Release with auto-generated notes

7. **Verify on npm**. `npm view @lumencast/runtime` should show the new version.

## What gets published

| Package                     | Notes                         |
| --------------------------- | ----------------------------- |
| `@lumencast/protocol`       | Foundation — no internal deps |
| `@lumencast/server`         | Depends on protocol           |
| `@lumencast/dev-server`     | Depends on protocol           |
| `@lumencast/runtime`        | Depends on protocol           |
| `@lumencast/runtime-svelte` | Depends on protocol           |
| `@lumencast/runtime-vue`    | Depends on protocol           |
| `@lumencast/compiler`       | Depends on protocol + runtime |

All packages share the same version. The release workflow publishes in dependency order so `workspace:*` references resolve to the just-published version.

## Rolling back

npm allows unpublishing within 72 h (`npm unpublish <pkg>@<version>`). After 72 h, ship a `<version>+1` patch instead.
