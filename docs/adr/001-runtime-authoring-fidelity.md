# ADR 001 — Fermer les gaps de fidélité design & animation du runtime (authoring Figma → antenne)

- **Status** : accepted
- **Date** : 2026-06-10
- **Decided** : 2026-06-10
- **Deciders** : @ClodoCapeo
- **Author** : Atlas
- **Supersedes** : —
- **Superseded by** : —

## 1. Context

L'audit moteurs (Lens, 2026-06-10, Zab `build/audit-engines/{design,animation}-gaps.md`) établit
que la chaîne d'authoring Figma → LSML → antenne casse côté **renderer/compiler**, pas côté format :

- **LSML 1.1 est en avance sur l'implémentation.** Sont spec'd mais non rendus : `shape`
  `pathData`/`paths[]` (§4.6 — `shape.tsx` ne dessine que rect/circle/line), la typo complète
  (`lineHeight`, `letterSpacing`, `textTransform`, `textDecoration`, `fontStyle`, `maxLines` —
  `schema.json` TextStyle, `text.tsx` ne lit que size/font/weight/colour/align),
  `frame.clipsContent` (§4.3), `bindAnimate` (§6.3 — 0 hit dans `runtime/src` et `compiler/src`),
  l'interpolation couleur sRGB (§6.5), `transition.mass` (§6.2).
- **Le compiler (`@lumencast/compiler`) est incomplet vs 1.1** — vérifié sur `compile.ts` /
  `lsml-types.ts` : il ne forwarde ni `profiles[]`, ni `metadata`, ni `fills[]`/`strokes[]`,
  ni `paths[]`, ni `clipsContent`, ni `keyframes`/`stagger_ms` ; `animate.from.filter` est
  droppé (`lowerAnimateState`), `scale: [sx,sy]` collapse à `sx`, et il émet
  `props.cornerRadius` alors que `shape.tsx` lit `resolved.radius` → le corner radius core est
  perdu en silence sur le chemin compilé. Le header de `lsml-types.ts` _annonce_ `fills[]`/
  `backgrounds[]`/profils 1.1 mais les types ne les portent pas.
- **Le runtime viole §17.5.1** : `validateBundleProfiles` (`render/bundle.ts:143-153`) rejette
  `BUNDLE_INCOMPATIBLE` tout profil hors `x-lumencast.color-srgb-1.0`, sans l'exception
  obligatoire pour les profils authoring (`.authoring/`). Un bundle du plugin Figma déclarant
  `x-figma.authoring/1` est soit rejeté à tort (chemin fetch direct), soit « passe » uniquement
  parce que le compiler a droppé `profiles[]` en amont. Non-conformité spec dans les deux cas.
- **Le profil `x-figma.authoring/1` est capturé mais jamais lu** : ombres, blend modes, masques,
  per-corner radii, strokes avancés, gradient transforms, text extras (spec
  `lumencast-protocol/spec/profiles/figma-authoring.md` §1-11) sont du travail mort au rendu.
  Les gradients angular/diamond sont droppés dès le plugin (`color.ts` → null) faute de
  représentation core.

Consommateurs : Zab (Solar = adaptateur mince sur `@lumencast/runtime` depuis Zab ADR 007),
plus tout adopteur Lumencast. Le runtime React est canonique ; `runtime-svelte`/`runtime-vue`
et les SDK go/rs/py existent aussi (impact portabilité).

Gouvernance amont : `lumencast-protocol` se gouverne par RFC (`RFC-PROCESS.md`) + `DECISIONS.md`,
pas par ADR — d'où le choix de loger cet ADR ici (lumencast-js, premier ADR du repo) et de
porter la partie spec via une issue `[RFC]` sur le repo protocol.

## 2. Decision drivers

1. **Doctrine protocole déjà tranchée** — DECISIONS.md 2026-05-04 : « anything that genuinely
   affects portable rendering still belongs in core LSML (and triggers an RFC) » ; précédent
   2026-05-03 (promotion additive de `position`/`paths[]`/`clipsContent` en 1.1).
2. **Portabilité multi-runtime** : un runtime canonique qui rendrait `metadata.figma.*`
   rendrait les bundles non portables vers les autres SDK et inverserait le sens du §17.5
   (« a portable runtime reads the primitives »).
3. **Aucun drop silencieux** : un design valide qui rend faux sans alerte est le pire mode de
   défaillance pour l'authoring (exigence porteur).
4. **Budgets durs** : bundle gz `broadcast` ≤ 200 KiB, delta→DOM p95 ≤ 50 ms, 0 layout event
   sur le hot path d'animation (CLAUDE.md lumencast-js).
5. **Rétro-compat** : tout changement spec doit être additif (LSML 1.x), tout changement
   compiler/runtime ne doit pas casser les bundles 1.0/1.1 existants.

## 3. Decision

**Verdict : GO**, en quatre décisions et trois phases. Le runtime **n'implémente pas**
`x-figma.authoring/1` ; on rembourse d'abord la dette d'implémentation 1.1, on implémente
`bindAnimate`, on promeut les capacités universelles dans le core via RFC LSML 1.2, et on
installe une politique anti-drop-silencieux transverse.

### 3.1 D1 — Profil Figma : remontée dans le core, pas d'implémentation runtime du profil

Le runtime ne lira jamais `metadata.figma.*` pour rendre. Les capacités **universelles de
rendu** (présentes dans CSS, Figma, Sketch, Penpot) remontent dans le core LSML par RFC
additif **LSML 1.2** sur `lumencast-protocol` :

- `effects[]` universel (drop-shadow, inner-shadow, layer-blur, backdrop-blur) ;
- `blendMode` universel (enum CSS `mix-blend-mode`) ;
- `cornerRadius: number | [tl, tr, br, bl]` (per-corner, additif) ;
- strokes avancés : `strokes[]` étendu de `{dashPattern, cap, join, miterLimit, align}` ;
- Fill union : `angular-gradient` (conic) et `diamond-gradient` + `transform` matrice 2×3
  optionnelle sur tous les gradients (remplace la dégradation lossy en `angle_deg`) ;
- masques : `mask` (node-level, alpha/luminance, geometry par référence à un enfant `shape`).

Une fois 1.2 acceptée, le plugin Figma migre ces champs de `metadata.figma.*` vers le core
(fallback metadata conservé en 1.x, retrait au 2.0, conformément à DECISIONS.md 2026-05-03).
`x-figma.authoring/1` reste le contrat de **roundtrip** pour ce qui est réellement
vendor-specific (constraints, layout overrides, corner smoothing/squircle, textRanges,
image filters) — advisory, jamais rendu.

**Alternatives écartées** :

- _Implémenter le profil dans le runtime_ : viole la doctrine §17.5/DECISIONS.md, couple le
  runtime canonique à Figma, non portable vers go/rs/py/svelte/vue, fait du profil un
  standard de facto non gouverné par RFC.
- _Statu quo (profil roundtrip-only sans promotion core)_ : laisse ~60 % de la fidélité
  capturée morte au rendu ; l'authoring Zab reste bloqué.
- _Tout pousser en 1.2 d'un coup (y c. typo/paths)_ : inutile — la moitié des gaps est déjà
  spec'd en 1.1, c'est de la dette d'implémentation pure (Phase A), pas un sujet de spec.

### 3.2 D2 — Phase A : rembourser la dette d'implémentation LSML 1.1 (aucun changement de spec)

Dans `lumencast-js`, runtime React canonique + compiler :

1. **Conformité profils §17.5.1** : `validateBundleProfiles` ignore (sans rejet) tout
   identifiant dont la **forme complète** est `x-<vendor>.authoring/<major>` — `.authoring`
   comme **segment terminal exact** du nom avant le `/<major>`, jamais un test substring
   (`x-evil.authoring/1` advisory = ignoré ; un profil comportemental dont le nom contient
   `.authoring` en position non terminale n'est **pas** exempté). Tout profil comportemental
   non supporté reste un rejet **dur** `BUNDLE_INCOMPATIBLE`. Le compiler forwarde
   `profiles[]` dans le `RenderBundle`.
2. **Compiler 1.1 complet** : types et lowering pour `fills[]`/`strokes[]`, `paths[]`/
   `pathData`, `clipsContent`, `keyframes` + `stagger_ms`, `animate.filter` (mount-play et
   transitions), `scale` per-axis ; correction du mismatch `cornerRadius`→`radius`.
   Les valeurs `filter` sont **clampées au lowering** (cap `blur`, cap `brightness` ≤ 4,
   valeurs négatives rejetées) — exigence Bastion R8, non optionnelle.
3. **Rendu path** : `shape.tsx` rend `geometry:"path"` via `<path d fill-rule>` (un élément
   par subpath, `windingRule` → `nonzero|evenodd`), viewBox depuis `size`.
4. **Typo complète** : `text.tsx` rend `lineHeight`, `letterSpacing`, `textTransform`,
   `textDecoration`, `fontStyle`, `maxLines` (line-clamp + ellipsis).
5. **Clipping** : `frame.tsx` rend `clipsContent` (défaut spec `true`) en `overflow: hidden` —
   propriété statique, hors hot path d'animation (pas de violation 0-layout-event).

### 3.3 D3 — Phase B : implémenter `bindAnimate` (§6.3) + interpolation couleur (§6.5)

- Compiler : lowering de `bindAnimate` vers un map `animateBindings` du `RenderNode`.
  Validation **dure** : toute clé hors propriétés animables §6.1 → **throw au compile**
  (pas un `onWarn`) — un `bindAnimate` malformé est une directive invalide, pas un champ
  spec'd non supporté ; la politique warn-by-default §3.4 ne s'applique pas ici.
- Runtime : **coalescing des deltas par frame** sur chaque binding (un retarget max par
  rAF) — borne le coût d'un flux LSDP haute fréquence (1 kHz) indépendamment du producteur.
- Runtime : par binding, souscription au signal leaf-grain existant → retarget d'une motion
  value Framer (tween ou spring §6.2, **avec `mass`** ajouté à `SpringTransition` et
  vélocité conservée au retarget). Aucun remount : interpolation continue vers la valeur live
  (jauges, barres data-driven). Compatible stagger §6.7.
- Couleurs : parser sRGB (§6.5 — hex/rgb()/hsl()/named) pour les cibles color-typed atteintes
  par `bindAnimate` ou les directives `transition` per-delta ; interpolation composant par
  composant.
- Transport : les leaves restent scalaires/arrays (codec LSDP) — `transform.translate` lit un
  leaf `[x, y]`, conforme §6.3 ; rien à changer côté protocole.

### 3.4 D4 — Politique anti-drop-silencieux (transverse, non négociable)

Tout champ **spec'd** non honoré doit produire un diagnostic ; le drop muet devient un bug.

- **Compiler** : comptabilité exhaustive des clés consommées par nœud. Toute clé reconnue par
  le schéma LSML mais non lowerée → `onWarn` (déjà dans `CompileOptions`, aujourd'hui jamais
  invoqué) avec `node.id` + champ + raison ; `strict: true` → throw. Les blocs
  `metadata.*` et profils `.authoring/` sont **exempts** (advisory par construction §17.5.1).
- **Runtime** : chaque primitive déclare l'allowlist des props consommées ; prop présente et
  non consommée → diagnostic remonté par le canal `onError`/diagnostics (jamais de log en mode
  `broadcast`, conformément au CLAUDE.md — le diagnostic est un événement, pas un console.log).
- **Hygiène des diagnostics (Bastion R9)** : un diagnostic anti-drop/`onWarn` n'inclut
  **jamais** la valeur d'un leaf ni d'une prop — uniquement `node.id` + nom du champ +
  raison. Les valeurs de leaves peuvent porter du contenu antenne sensible ; elles ne
  transitent par aucun canal de diagnostic.
- **Plugin Figma (suivi, hors périmètre immédiat)** : tant que LSML 1.2 n'est pas livrée, un
  export contenant angular/diamond gradient ou boolean op non-UNION doit afficher un warning
  d'export au lieu de dropper (issue de suivi sur `lumencast-figma`, après acceptation du RFC).
- **Conformance** : le RFC 1.2 ajoute des fixtures « no-silent-drop » au repo protocol.

### 3.5 Phasage et dépendances

| Phase | Contenu                                                                               | Dépendances                                                                                             |
| ----- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **A** | D2 (dette 1.1) + D4 compiler/runtime                                                  | aucune — démarrable immédiatement                                                                       |
| **B** | D3 (`bindAnimate`, color interp, spring mass)                                         | parallèle à A (touche `animate/`)                                                                       |
| **C** | D1 (RFC LSML 1.2 → implémentation runtime des nouveaux champs core, migration plugin) | acceptation du RFC sur lumencast-protocol (process BDFL actuel : triage maintainer possible avant 14 j) |

A et B se livrent en minors `@lumencast/compiler` / `@lumencast/runtime` (additif, semver
minor). C se livre après bump spec 1.2.

## 4. Consequences

- L'authoring Figma → antenne devient fidèle pour : vecteurs/paths, typo complète, clipping,
  multi-fills/gradients (y c. angular/diamond après 1.2), corner radius (per-corner après
  1.2), ombres/blend/masques (après 1.2) — et réactif en continu via `bindAnimate`.
- Le compiler devient la **frontière de vérité** : ce qui passe sans warning est rendu, ce qui
  ne l'est pas est signalé. Les pipelines existants peuvent voir apparaître des warnings sur
  des bundles déjà en prod (comportement par défaut : warn, pas throw — pas de breaking).
- Les runtimes `runtime-svelte`/`runtime-vue` et SDK go/rs/py **divergent temporairement** du
  runtime React canonique ; le RFC 1.2 doit lister les SDK impactés (exigence RFC-PROCESS §4).
- Croissance du bundle runtime (path render, parser couleur, bindAnimate) à contenir dans le
  budget 200 KiB gz `broadcast`.
- Zab/Solar bénéficie sans changement de code (adaptateur mince) via bump de dépendance.

## 5. Risks

| Risque                                                                                 | Sévérité               | Mitigation                                                                              |
| -------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| Dépassement du budget bundle 200 KiB gz                                                | moyen                  | CI `check:bundle` bloquante ; parser couleur minimal (pas de lib) ; tree-shake par mode |
| `bindAnimate` à haute fréquence de deltas → saturation retarget                        | moyen                  | spring velocity-carry (pas de remount) ; budget p95 ≤ 50 ms vérifié en E2E Playwright   |
| Blend modes / masques (1.2) créent des stacking contexts → coût compositing en CEF     | moyen                  | perf trace E2E (0 layout event) ; clamp éventuel documenté dans le RFC                  |
| Warnings anti-drop bruyants sur bundles existants                                      | faible                 | défaut warn-only, strict opt-in ; exemption metadata/authoring                          |
| Contenu non-trusté injecté dans le rendu (`pathData` SVG, couleurs CSS, dash patterns) | élevé                  | traité par construction : RC#10–RC#14 (threat model Bastion 2026-06-10)                 |
| RFC 1.2 retardé → Phase C glisse                                                       | faible                 | Phases A+B livrent ~70 % de la valeur sans spec change                                  |
| Divergence multi-SDK (go/rs/py/svelte/vue)                                             | accepté temporairement | listée dans le RFC ; runtime React = référence de conformance                           |

**Surface sécurité** : `pathData`/`paths[].data` (strings SVG `d` non-trustées rendues en
attribut), valeurs couleur/filter injectées en CSS inline, complexité de parse bornée
(anti-ReDoS), aucun nouvel accès réseau, aucun secret. Threat model Bastion rendu le
2026-06-10 (clearance conditionnée aux RC#10–RC#14 ci-dessous et aux acceptations §5.1) —
révision intégrée dans cette version de l'ADR.

### 5.1 Acceptations de risque écrites (threat model Bastion 2026-06-10)

- **R6 — Intégrité des bundles `.lsmlz` et chemin `preload()`** : le runtime ne vérifie
  aucun hash sur les bundles chargés, et `preload()`
  (`packages/runtime/src/render/bundle.ts:186-192`) injecte un `RenderBundle` directement
  dans le cache après la seule validation de profils. **Accepté hors périmètre runtime** :
  l'intégrité de livraison (hash/signature, anti zip-bomb à la décompression) appartient à
  la couche hôte/serving. **Porteur nommé : Keeper** (infra de serving des bundles —
  gateway/CDN/caps de décompression) ; **Conduit** est saisi si un champ d'intégrité doit
  entrer dans le contrat LSDP. `preload()` est documenté comme **chemin trusté uniquement** :
  réservé à un hôte qui a déjà établi la provenance du bundle ; jamais alimenté par une
  entrée réseau non vérifiée.
- **R7 — Fetch des `instance` imbriquées** : le scaffold actuel ne fetch pas
  (`packages/runtime/src/render/primitives/instance.tsx:17-21` — depth-8 et détection de
  cycle §4.9.2 explicitement non implémentés). L'activation du fetch d'inner bundles est
  **gated** : interdite tant que la limite depth-8 ET la détection de cycle §4.9.2 ne sont
  pas implémentées au resolver, et soumise à **re-clearance Bastion** à ce moment-là.
- **R8 — Clamp dur des valeurs `filter` au lowering** : cap `blur`, cap `brightness` ≤ 4,
  valeurs négatives rejetées (cf. §3.2.2). Non optionnel — un `filter` non borné est un
  DoS compositing en CEF.
- **R9 — Hygiène des diagnostics** : aucun diagnostic anti-drop/`onWarn` n'inclut la valeur
  d'un leaf ou d'une prop — seulement `node.id` + champ + raison (cf. §3.4).

## 6. Resolution criteria

Testables, tous mesurés en CI `lumencast-js` sauf mention :

1. **Profils** : un bundle déclarant `profiles: ["x-figma.authoring/1"]` est rendu sans
   `BUNDLE_INCOMPATIBLE` (fixture conformance `bundle-authoring-profile-ignored` verte contre
   le runtime) ; un profil dash-form inconnu rejette toujours.
2. **Compiler 1.1** : `compileBundle` forwarde `profiles[]`, `fills[]`, `strokes[]`,
   `paths[]`/`pathData`, `clipsContent`, `keyframes`+`stagger_ms`, `animate.from.filter`,
   `scale:[sx,sy]` ; un `cornerRadius` LSML produit un `rx` non nul dans le DOM (test
   bout-en-bout compiler→render).
3. **Paths** : un `shape geometry:"path"` avec 2 subpaths et `windingRule` mixte produit 2
   `<path>` avec `fill-rule` corrects (DOM smoke, happy-dom).
4. **Typo** : chaque champ TextStyle spec'd (`lineHeight`, `letterSpacing`, `textTransform`,
   `textDecoration`, `fontStyle`) + `maxLines` a un test DOM smoke prouvant le style calculé.
5. **Clipping** : `clipsContent` absent ou `true` → `overflow: hidden` ; `false` → visible.
6. **bindAnimate** : E2E dev-server — un delta sur un leaf bindé anime `opacity` et
   `transform.translate` en continu (pas de remount : le nœud DOM est identique avant/après) ;
   un retarget spring en cours de course ne snap pas (vélocité conservée) ; couleur bindée
   interpole en sRGB.
7. **Anti-drop** : une suite de fixtures « champ spec'd non supporté » produit ≥ 1 `onWarn`
   par champ avec `node.id` + nom du champ ; `strict: true` throw ; zéro fixture en drop muet.
8. **Budgets tenus** : bundle gz `broadcast` ≤ 200 KiB, delta→DOM p95 ≤ 50 ms, 0 layout event
   sur le hot path (jobs CI existants verts).
9. **RFC** : issue `[RFC] LSML 1.2` ouverte sur `lumencast-protocol` couvrant effects, blend
   modes, masques, per-corner radius, strokes avancés, angular/diamond gradients, gradient
   transform, avec analyse rétro-compat et liste des SDK impactés.
10. **Paths adversariaux (Bastion)** : la grammaire du `d` SVG est **allowlistée**
    (commandes `MmLlHhVvCcSsQqTtAaZz` + nombres uniquement) ; rejet de `url(`, `data:`,
    `<`, `&` ; cap **8 KiB par subpath** + cap sur le nombre de subpaths et de commandes.
    La validation s'applique **au compile ET au runtime** — les props sont pilotables live
    via deltas LSDP (`resolveProps`, `packages/runtime/src/render/tree.tsx:166-175`), donc
    la validation compile seule ne suffit pas. Fixture adversariale : `d` à 10⁶ commandes,
    `d` contenant `url(...)`, `data:`, `<` → rejet/cap **sans freeze** du renderer.
11. **CSS strict (Bastion)** : parser couleur **strict** (hex / `rgb()` / `hsl()` / named
    canonique ; regex **ancrées** ; rejet de `url(`, `;`, `}`) appliqué à **toute** valeur
    color/dash/filter rendue en CSS inline — y compris la **correction du code existant** :
    `cssWithOpacity` (`packages/runtime/src/render/fill.tsx:140-151`, `color-mix(...)`
    interpole aujourd'hui une chaîne non parsée), `legacyBackground`
    (`packages/runtime/src/render/primitives/frame.tsx:49`) et `colour`
    (`packages/runtime/src/render/primitives/text.tsx:14`). Testé via prop **statique** ET
    via **delta live**.
12. **Anti-ReDoS (Bastion)** : les parsers couleur et path sont en **temps linéaire**
    (regex sans backtracking exponentiel / scanner manuel — justification écrite dans le
    code), fuzz dédié en CI, borne **≤ 1 ms par valeur** parsée ; le budget p95 delta→DOM
    ≤ 50 ms est tenu **aussi sous payload pathologique** (fixture RC#10 jouée en E2E).
13. **bindAnimate anti-DoS (Bastion)** : clé `bindAnimate` hors propriétés animables §6.1
    → **throw au compile** (pas un warn) ; le runtime **coalesce les deltas par frame**
    (un retarget max par rAF et par binding) ; E2E : flux à **1 kHz** sur N leaves bindés →
    p95 ≤ 50 ms tenu et **0 layout event**.
14. **Profil authoring strict (Bastion)** : le matching `.authoring/` porte sur la forme
    complète `x-<vendor>.authoring/<major>` (segment terminal exact, jamais substring).
    Tests : `x-evil.authoring/1` (advisory, ignoré sans rejet) ET un profil comportemental
    dont le nom contient `.authoring` en position **non terminale** (non exempté → rejet) ;
    tout profil comportemental non supporté = **`BUNDLE_INCOMPATIBLE` dur**.

## 7. Suivi de livraison

### 7.1 Phase A + B — delivered 2026-06-10

Toutes les RC des phases A et B sont satisfaites. PRs mergées sur `main` :

| PR | Titre abrégé | RC satisfaites |
| --- | --- | --- |
| #36 | Strict CSS colour parser + fix injection sites (fill/frame/text) | RC#11 |
| #37 | Authoring profiles advisory + compiler forwarde `profiles[]` | RC#1, RC#14 |
| #38 | Typo complète (`lineHeight`, `letterSpacing`, `textTransform`, `textDecoration`, `fontStyle`, `maxLines`) | RC#4 |
| #39 | Compiler 1.1 lowering complet (`fills[]`, `strokes[]`, `paths[]`/`pathData`, `clipsContent`, `keyframes`+`stagger_ms`, `animate.from.filter`, `scale [sx,sy]`, `cornerRadius`→`radius`) | RC#2 |
| #40 | Rendu `shape geometry:"path"` — `<path d fill-rule>` par subpath, viewBox, `windingRule` | RC#3, RC#10 |
| #43 | `frame.clipsContent` → `overflow: hidden/visible` | RC#5 |
| #44 | CI durcie : job `e2e` gatant, `.gitattributes` line-endings | — |
| #45 | `bindAnimate` §6.3 + sRGB color interp §6.5 + spring `mass` + re-clamp filter live R8 | RC#6, RC#12, RC#13 |
| #46 | Anti-silent-drop : comptabilité clés consommées, `onWarn`/`strict`, primitive prop allowlists | RC#7 |

RC#8 (budgets `broadcast` ≤ 200 KiB, delta→DOM p95 ≤ 50 ms, 0 layout event) et RC#9 (RFC LSML 1.2 ouverte sur `lumencast-protocol` — issue #34 dudit repo) ont également été validées à l'occasion de la campagne.

### 7.2 Phase C — pending RFC LSML 1.2

La phase C (D1 : `effects[]`, `blendMode`, per-corner `cornerRadius`, `strokes[]` avancés, `angular-gradient`/`diamond-gradient`, `mask`) est **gated** sur l'acceptation du RFC LSML 1.2 (`lumencast-protocol#34`). Aucune implémentation runtime des nouveaux champs core n'est démarrée avant ce jalón.
