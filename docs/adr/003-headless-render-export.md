# ADR 003 — Export public de rendu headless `RenderBundle → PNG` dans `@lumencast/runtime`

- **Status** : accepted
- **Date** : 2026-06-19
- **Decided** : 2026-06-19
- **Deciders** : @ClodoCapeo
- **Author** : Atlas
- **Supersedes** : —
- **Superseded by** : —

> Besoin (cf. `Zab/_design/solar-headless-render-pitch.md`) : ZabCanvas doit produire, à
> chaque save de scène, un PNG **rendu par le moteur Lumencast réel** (preuve de rendu +
> vignette Prism). Décision porteur ferme : **pas de 2e renderer, pas de service
> `canvas-render`** — le PNG sort de `@lumencast/runtime`. Solar reste un adaptateur pur.
> Le harness 0-perte (ADR 002 #J) prouve déjà la faisabilité en interne ; cet ADR promeut
> ce pattern en capacité **publique** du runtime. Cet ADR ne couvre QUE le contrat runtime
> (publié npm). Le wrapper-hôte, la résolution des assets en prod et le déclencheur Canvas
> sont dans **ZabCanvas ADR 005** ; l'état Canvas (`render_status`, `thumbnail`) est figé
> par **ZabCanvas ADR 004 §3.3** — non rouvert ici.

## 1. Context

`@lumencast/runtime` 0.7.0 ne sait pas rendre hors WS : son seul export utile est
`mount()` (`mount.ts:112`, `createRoot`), qui ouvre toujours un WebSocket et attend un
snapshot LSDP. Les briques de rendu pur existent mais sont **internes** :

- `LumencastRuntimeProvider` (`overlay/runtime-context.tsx`) — fournit
  `LumencastRuntime { mode, store, bundle, status, sendInput }`. C'est le seam exact.
- `BroadcastMode` (`modes/broadcast.tsx`) — `AllowedHostsProvider(readAllowedHosts(bundle))`
  → `ShapeIndexProvider` → `<Tree>`. Aucun chrome.
- `RenderBundle`, `readAllowedHosts`, le host-allow gate (`render/allowed-hosts.tsx`,
  deny-by-default, ADR 002 #E/#F, Bastion T1/T2) — déjà publics ou semi-publics.

Le **harness 0-perte** (`tests/e2e/zero-loss/harness-entry.tsx`) monte déjà exactement
`LumencastRuntimeProvider({mode:"broadcast", store, bundle, status:"live", sendInput:noop})`

> `BroadcastMode` dans un `#scene` 1920×1080, pose `window.__harnessReady` après double
> rAF, et Playwright Chromium le screenshote. **C'est la capacité à publier.**

Le compilateur LSML→`RenderBundle` vit dans `@lumencast/compiler` (`compileBundle`, pkg
0.7.0), **pas** dans le runtime. Le contrat headless consomme donc un **`RenderBundle`
déjà compilé** — cohérent avec ZabCanvas ADR 004 §3.3 (entrée = bundle de `lsml_bundles`).

## 2. Decision drivers

- **D1 — Un seul moteur.** Le PNG doit traverser le chemin de rendu de prod
  (`BroadcastMode` → `<Tree>`), pas une réimplémentation. Promouvoir le harness, pas le dupliquer.
- **D2 — Surface publique minimale et stable.** Le runtime publie `mount()` + types ;
  tout ajout est contractuel (bump major si breaking). On ajoute le strict nécessaire.
- **D3 — Le gate host-allow ne se contourne jamais.** Le harness substitue `data:` à
  `data:` ; aucun fetch réseau du runtime, deny-by-default préservé (Bastion).
- **D4 — Asset manquant = trou documenté, jamais maquillé.** Borne ADR 002 (`omis +
diagnostic R9, jamais passthrough`). Le contrat headless doit la propager, pas la masquer.
- **D5 — Le runtime ne fait pas de screenshot.** Encoder PNG = Chromium/Playwright, côté
  hôte. Le runtime produit du **DOM rendu + un signal de readiness**, rien de plus (D2).

## 3. Decision

### 3.1 — Forme de l'export : entrypoint montable, PAS `renderToStaticMarkup`

On expose une **fonction de montage client** `renderBundleHeadless`, pas un
`{ html: string }` via `renderToStaticMarkup`. Justification :

- Le rendu de prod dépend du **layout effectif du navigateur** (object-fit, `@font-face`
  chargées, masques SVG, filtres GPU). `renderToStaticMarkup` produit du markup **non
  layouté** : le PNG en serait infidèle (fonts non mesurées, masques non composés). Le
  harness 0-perte screenshote un **DOM vivant settled**, pas du markup statique — c'est la
  seule forme qui garantit la fidélité SSIM d'ADR 002.
- L'export rend dans un `target: HTMLElement` fourni (comme `mount()`), monte le provider
  - `BroadcastMode`, et **résout une promesse de readiness** après double rAF + attente des
    fonts (`document.fonts.ready`). L'hôte (Playwright) screenshote alors le `target`.

Contrat proposé (forme tranchée ; signature fine ajustable par Forge sans re-décision) :

```ts
export interface HeadlessRenderOptions {
  bundle: RenderBundle; // déjà compilé (via @lumencast/compiler côté hôte)
  target: HTMLElement; // nœud monté, dimensionné par l'hôte (stage)
  defaults?: Record<string, unknown>; // store initial (store.reset(defaults))
  stage?: { width: number; height: number }; // défaut 1920×1080 ; pose la taille du target
  onDiagnostic?: DiagnosticHandler; // canal anti-drop existant (assets omis, R9)
}
export interface HeadlessRenderHandle {
  ready: Promise<void>; // résolue après layout settled + fonts chargées
  unmount(): void;
}
export function renderBundleHeadless(opts: HeadlessRenderOptions): HeadlessRenderHandle;
```

Ce que la fonction fait, ni plus ni moins : `createStore()` + `store.reset(defaults)` ;
`createRoot(target).render(<LumencastRuntimeProvider value={{mode:"broadcast", store,
bundle, status:"live", sendInput:noop}}><BroadcastMode/></…>)` ; câble `onDiagnostic` sur
le canal existant ; résout `ready` après `requestAnimationFrame×2` **et**
`document.fonts.ready`. C'est le harness, généralisé et débarrassé des swatches de test.

**Alternative écartée — entrypoint HTML statique screenshootable** (`host-entry.tsx` sans
WS, bundle par query/postMessage) : déplace la complexité (sérialisation du bundle dans
l'URL/postMessage, gestion d'un HTML packagé) dans le runtime publié, et fige une frontière
de transport que chaque hôte devrait re-parser. Une fonction laisse l'hôte (Solar headless
entry / worker Zab) composer son propre HTML d'amorçage. Plus simple, plus testable, aligné
sur la surface `mount(target)` existante.

**Alternative écartée — `renderToStaticMarkup` / SSR** : infidèle au layout (cf. supra) ;
casse la garantie SSIM d'ADR 002. Rejetée.

### 3.2 — Résolution des assets : le runtime NE fetch PAS ; il consomme un bundle déjà résolu

Le contrat **n'inclut pas de `AssetResolver` actif** (pas de callback qui irait chercher
des bytes). Le runtime rend le bundle **tel quel** ; toute substitution d'asset
(`assets/<hash>.ext` → URL concrète) est faite **par l'hôte, dans le bundle, avant l'appel**
— exactement comme le harness (`rewriteLayoutSrcs` / `rewriteDefaultsSrcs` vivent côté
harness, pas côté runtime). Justification :

- **D3/sécu.** Si le runtime publié fetchait des hôtes, il deviendrait une surface SSRF
  publiée (déjà veto Bastion sur le chemin reconstructed côté Canvas). En ne fetchant
  jamais, le gate host-allow reste la seule autorité, et l'hôte porte la responsabilité du
  réseau. Le runtime ne fait que ce que `<Tree>` fait déjà : poser des `src` (gatés par
  `gateSrc`/`AllowedHostsProvider`) dans le DOM, que le navigateur charge.
- **Le gate s'applique inchangé.** Le bundle porte son `assets.allowedHosts`
  (`readAllowedHosts`). Si l'hôte réécrit les refs en `data:` (modèle harness),
  `allowedHosts:[]` les admet (data: est toujours autorisé). Si l'hôte laisse des URLs
  remote, elles doivent figurer dans `allowedHosts` ou elles sont **omises + diagnostic**
  (D4). Aucun chemin ne rouvre le gate.

Ce que le runtime **expose pour l'hôte** (utilitaires, pas de fetch) : on **publie** depuis
`@lumencast/runtime` les helpers déjà éprouvés du harness pour que tout hôte (Solar/worker
Zab) résolve de façon identique et exerce le même gate —
`rewriteLayoutSrcs`, `rewriteDefaultsSrcs`, `resolveSrc` (rewrite des refs `assets/<hash>`
contre une table) et `injectFonts`/`FontFace` (chargement `@font-face` data:, bloquant
avant la 1ʳᵉ frame). Aujourd'hui sous `tests/e2e/zero-loss/asset-resolver.ts` ; promus en
module public `render/asset-resolve.ts`.

> **Conséquence pour Canvas (ADR 005).** « D'où viennent les vrais assets » est tranché
> côté Zab : table content-addressed `<hash> → bytes` servie en `data:`/URL interne, jamais
> un CDN public arbitraire dans le runtime. Le runtime n'en sait rien — il rend ce qu'on
> lui donne et gate ce qui reste remote.

### 3.3 — Fonts : chargement bloquant avant la première frame

`renderBundleHeadless` résout `ready` seulement après `document.fonts.ready`. L'hôte injecte
ses `@font-face` (via `injectFonts`, data: URIs) **avant** d'attendre `ready`. Sans ça, le
premier paint utilise la fallback-font → PNG infidèle (FOUT figé dans le screenshot). C'est
la leçon directe du harness (`injectFonts` bloque jusqu'au chargement).

### 3.4 — Diagnostics : le canal anti-drop est le rapport de fidélité

Tout asset omis (host rejeté, ref non résolue), tout champ LSML non honoré, remonte par
`onDiagnostic` (`{ nodeId, field, reason }`, jamais la valeur — R9). L'hôte agrège ces
diagnostics : ils constituent la **preuve de rendu** (un PNG sans diagnostic = rendu plein ;
avec = trous documentés, jamais maquillés — D4). C'est ce que ZabCanvas stockera à côté du
PNG pour son `render_status`.

## 4. Consequences

- **Surface publique +1 fonction +1 module utilitaire.** `renderBundleHeadless` +
  `HeadlessRenderOptions/Handle` ; `render/asset-resolve.ts` (`rewriteLayoutSrcs`,
  `rewriteDefaultsSrcs`, `resolveSrc`, `injectFonts`, `FontFace`). Bundle `broadcast`
  inchangé (tree-shake : la fonction est un entry séparé, pas tiré dans `mount`).
- **Le harness 0-perte se réécrit sur l'export public** — il devient le premier
  consommateur (cesse d'importer les internals), ce qui prouve en CI que l'export rend
  fidèlement (SSIM ADR 002 inchangé). Garde anti-régression naturelle.
- **`@lumencast/compiler` reste hors runtime** : l'hôte compile LSML→bundle si besoin ;
  ici ZabCanvas a déjà le bundle compilé (`lsml_bundles`). Aucun couplage nouveau.
- **Publié npm** (bump mineur `0.8.0` : ajout rétro-compatible). Solar/Zab consomment depuis
  npm, jamais la source.

## 5. Risks

- **R1 — Infidélité fonts/layout si l'hôte n'attend pas `ready`.** _Mitig._ : `ready`
  intègre `document.fonts.ready` ; doc explicite ; le harness public le prouve en CI.
- **R2 — Tentation d'ajouter un fetch dans le runtime** (« et si l'hôte n'a pas réécrit ? »).
  _Mitig._ : décision §3.2 grave que le runtime ne fetch jamais ; tout remote non-allowlisté
  est omis+diagnostic. **Toute évolution vers un fetch runtime = nouveau threat-model
  Bastion obligatoire** (surface SSRF publiée).
- **R3 — Couverture des modes.** `BroadcastMode` seulement (pas `control`/`test`) — c'est le
  mode antenne, le bon. Acté.
- **R4 — `status:"live"` injecté statiquement** court-circuite la machine d'état WS. _Mitig._
  : c'est précisément le seam prouvé par le harness ; aucun composant `broadcast` ne dépend
  d'une transition WS (seul `status` est lu). Couvert par le test SSIM.

> **Clearance Bastion requise avant merge** (surface : host-allow gate exposé, garantie
> no-fetch, R2). Conditionnelle attendue, pas un veto — le gate est inchangé et le runtime ne
> gagne aucune capacité réseau. Bastion confirme : (a) `renderBundleHeadless` n'introduit
> aucun chemin de fetch ; (b) `resolveSrc`/`injectFonts` publiés ne permettent que des
> substitutions de scheme déjà admises ; (c) diagnostics R9-clean (pas d'URL/valeur).

## 6. Resolution criteria (testables)

- **RC1** — `@lumencast/runtime` exporte `renderBundleHeadless` + types depuis `index.ts` ;
  `tsc` des consommateurs voit la signature §3.1.
- **RC2** — Le harness 0-perte (ADR 002 #J) est réécrit pour appeler `renderBundleHeadless`
  (n'importe plus `BroadcastMode`/`LumencastRuntimeProvider`/internals) ; le test SSIM
  `zero-loss.spec.ts` reste **vert au même seuil** qu'avant (preuve de non-régression de
  fidélité par le chemin public).
- **RC3** — `renderBundleHeadless` ne contient **aucun** appel réseau (grep CI : pas de
  `fetch`/`XMLHttpRequest`/`import()` dynamique de remote dans le module) ; un bundle avec un
  `src` remote hors `allowedHosts` produit un diagnostic `{nodeId,field,reason}` et un DOM
  sans cet asset (test unit : asset omis, jamais posé).
- **RC4** — `ready` ne résout qu'après `document.fonts.ready` ET double rAF (test : une font
  injectée tardivement est présente dans le DOM mesuré quand `ready` résout).
- **RC5** — `render/asset-resolve.ts` exporte `rewriteLayoutSrcs`, `rewriteDefaultsSrcs`,
  `resolveSrc`, `injectFonts`, `FontFace` ; tests unit migrés depuis le harness, verts.
- **RC6** — Bundle `broadcast` : budget de taille inchangé (l'export headless n'est pas tiré
  dans le chemin `mount`/broadcast — vérifié par le job budget CI existant).
- **RC7** — Clearance Bastion enregistrée (Amendment) avant merge ; conditions T-équivalentes
  injectées comme critères d'acceptation sur les issues si conditionnelle.
