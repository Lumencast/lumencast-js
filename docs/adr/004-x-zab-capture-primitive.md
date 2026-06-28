# ADR 004 — Implémenter le primitive `x-zab.capture` (placeholder transparent) dans compiler + runtime

- **Status** : accepted — see **Amendment 1** (2026-06-23, proposed, re-validation Vigil pending)
- **Date** : 2026-06-23
- **Decided** : 2026-06-23
- **Deciders** : @ClodoCapeo
- **Author** : Atlas
- **Supersedes** : —
- **Superseded by** : —

> ⚠️ **Amendment 1 (2026-06-23)** : le runtime devient **context-aware** (ACQUIRE en hôte
> capture-capable / PLACEHOLDER sinon), suite à RFC-0001 Amendment 1. La §3.2 « Runtime »
> ci-dessous est le texte accepté d'origine (inerte partout), SUPERSEDED par l'Amendment 1
> en fin de doc. Lire l'Amendment 1 pour le comportement liant.

> Implémente côté SDK TS la décision de format **RFC-0001** (`lumencast-protocol/spec/rfc/
RFC-0001-x-zab-capture.md`). L'RFC tranche _quoi_ (le kind, sa sémantique) ; cet ADR
> tranche _comment_ dans `@lumencast/compiler` et `@lumencast/runtime`. À n'accepter
> qu'une fois RFC-0001 en `rfc:accepted`.

## 1. Context

Le composant Canvas `source` (webcam/écran/app-audio/micro) est droppé à l'export bundle
(`Prism/.../lsml/from-scene.ts`) faute de représentation LSML → absent du bundle → invisible
en preview cockpit et à l'antenne (cf. RFC-0001 §Motivation). Le format ne sait pas exprimer
« une box transparente de classe X, nommée logiquement Y, ici ». RFC-0001 ajoute pour cela un
primitive vendor `x-zab.capture` (LSML 1.1, §17.1, additif, pas de bump majeur).

Le SDK doit donc : (a) faire passer ce kind à travers le compiler sans le rejeter ni en
perdre les props vendor ; (b) le rendre comme une box strictement transparente au runtime,
sans jamais acquérir de stream. État actuel pertinent du SDK :

- **Compiler** (`packages/compiler/src/compile.ts`) : un `switch (node.kind)` (~l.312) avec
  une whitelist de kinds et `KIND_NODE_KEYS` par kind ; tout kind hors liste / toute prop
  non-allowlistée est traité comme inconnu. Aucun chemin `x-<vendor>.*` aujourd'hui.
- **Runtime** (`packages/runtime/src/render/tree.tsx` ~l.79) : kind inconnu →
  `emitDiagnostic(node.id, "kind", "unknown render kind ; node not rendered")` et **skip
  silencieux** — non conforme à §17.1.2 (qui exige `BUNDLE_INCOMPATIBLE`). Un primitive par
  fichier sous `packages/runtime/src/render/primitives/` (`media.tsx`, `image.tsx`, …).
- **Profiles** : le runtime gère déjà des entrées d'extension (`bundle.ts` ~l.135,
  `x-lumencast.color-srgb-1.0`).

## 2. Decision drivers

- **Conformité RFC-0001 / §17.1** : kind reconnu → rendu ; props `x-zab.*` préservées
  (pas de `DROPPED_FIELD`) ; box réservée comme un `image` de même géométrie.
- **Inertie stricte** : zéro acquisition. Aucune dépendance DOM media (`<video>`,
  `getUserMedia`, `MediaStream`). Le placeholder est inerte par construction — c'est le
  contrat, pas une dégradation.
- **Frontière dure** : Lumencast ne résout JAMAIS un device ni ne compose ; `deviceRef` est
  opaque pour le runtime (métadonnée pour le resolver hors-bundle de l'app consommatrice).
- **Surface minimale** : un primitive ajouté, un case ajouté, aucune régression sur les 9
  primitives existants ni sur le hash des bundles sans capture.

## 3. Decision

### 3.1 Compiler

- Reconnaître `kind === "x-zab.capture"` dans `compileNode` : nouveau case qui émet un
  `RenderNode` `{ kind: "x-zab.capture", props: { "x-zab.sourceKind", "x-zab.deviceRef",
size, + universal props } }`.
- Étendre la validation des props : `KIND_NODE_KEYS["x-zab.capture"] = Set(["x-zab.sourceKind",
"x-zab.deviceRef", "size"])` (les universal props passent déjà par `COMMON_NODE_KEYS`).
  Les props préfixées `x-zab.` ne déclenchent PAS de `DROPPED_FIELD`.
- Valider la forme : `x-zab.sourceKind ∈ {media.webcam, media.screen, media.window,
media.app_audio, media.mic}` ; `x-zab.deviceRef` match `^[a-z][a-z0-9-]{0,63}$` (rejette un
  `device_id` physique / UUID → `INVALID_VALUE`) ; `size` requis si `sourceKind` visuel
  (webcam/screen/window), optionnel sinon.
- **Ne PAS** généraliser le pass-through `x-*` ici : seul `x-zab.capture` est implémenté. Tout
  autre `x-<vendor>.*` reste « kind inconnu » (comportement actuel) — l'élargissement du
  support vendor générique est hors périmètre.

### 3.2 Runtime

- Nouveau primitive `packages/runtime/src/render/primitives/capture.tsx` : rend une box
  réservant exactement la géométrie (size + universal props + layout englobant), peinture
  **totalement transparente** (aucun pixel, aucun élément à paint visible — un
  `<div>`/placeholder de dimensions données, `opacity`/`visible` respectés, rien d'autre).
  N'appelle ni `getUserMedia`, ni `MediaStream`, n'instancie aucun `<video>`/`<audio>`.
- Brancher le case dans `tree.tsx` (à côté des 9 autres) ; enregistrer dans
  `render/primitives/index.ts`. `x-zab.deviceRef` n'est PAS lu par le rendu.
- **Absence de stream = contrat** : aucun diagnostic émis pour « pas de média ».
- Publier le profile supporté `x-zab.capture/1` dans la liste de profiles du runtime
  (mécanisme `bundle.ts`/§17.3) pour la lisibilité machine de la dépendance.
- **Hors périmètre de cet ADR (noté en risque, pas corrigé ici)** : le skip silencieux des
  kinds réellement inconnus dans `tree.tsx` (non conforme §17.1.2). Reconnaître
  `x-zab.capture` suffit à ne pas tomber dans ce chemin ; le durcissement
  `BUNDLE_INCOMPATIBLE` générique est un bug de conformance séparé (cf. RFC-0001 §Unresolved 1).

### 3.3 Ce que cet ADR ne fait PAS

- Aucune acquisition, aucun mapping `deviceRef → device`, aucun `getUserMedia` — tout cela
  vit dans l'app consommatrice (Prism main process / Solar webview / Pulsar natif), traité
  par l'ADR/issues Prism, pas ici.
- Aucune modif des SDK `runtime-svelte` / `runtime-vue` (hors périmètre Zab ; ils tomberont en
  strict-fallback tant qu'ils n'embarquent pas le plugin — comportement attendu §17.1.2).

## 4. Consequences

- Les bundles avec `x-zab.capture` deviennent **non-portables** vers un runtime sans plugin
  Zab (par design, §17.1.2). Le runtime vendored dans Solar embarque ce plugin → preview +
  antenne le reconnaissent.
- Les bundles **sans** capture sont strictement inchangés (même hash, même rendu) : le case
  est purement additif.
- Le compiler cesse de dropper `source` une fois Prism émet `x-zab.capture` (issue Prism) :
  l'élément traverse jusqu'au runtime, où il réserve sa box transparente. L'app pose ensuite
  le stream réel (preview) ou la source native Pulsar (antenne) sur cette box.

## 5. Risks

- **R1 — Conformance strict-fallback non corrigée.** Le runtime reste non conforme §17.1.2
  pour les _autres_ kinds inconnus. Atténuation : reconnu = pas concerné ; bug séparé tracké.
- **R2 — Dérive géométrique placeholder ↔ source native.** Si l'app ne dérive pas le
  transform de la source native DE la box résolue, ça drifte. Hors format ; contrat d'app
  (à porter par l'ADR Prism). Noté pour que la frontière ne soit pas mal implémentée.
- **R3 — Élargissement vendor accidentel.** Tentation d'ouvrir un pass-through `x-*`
  générique. Refusé ici (3.1) : un seul kind implémenté, surface maîtrisée.
- **R4 (sécu, → Bastion si touché)** : aucune surface réseau/device ajoutée côté Lumencast
  (le primitive est inerte). La surface sensible (permissions media) est entièrement côté
  Pulsar C++ — traitée par l'issue Pulsar gated Bastion, pas ici.

## 6. Resolution criteria (testables)

- **RC1** : un bundle contenant `{ kind: "x-zab.capture", "x-zab.sourceKind":
"media.webcam", "x-zab.deviceRef": "primary-cam", size:{w,h} }` compile **sans**
  `DROPPED_FIELD` ni `INVALID_VALUE` et produit un `RenderNode` conservant les props vendor.
- **RC2** : le runtime rend ce nœud comme une box de la géométrie déclarée, **0 pixel peint**,
  **0** appel `getUserMedia`/`MediaStream`/`<video>`/`<audio>` (assert par spy/DOM), **0**
  diagnostic d'absence de média.
- **RC3** : `x-zab.deviceRef` invalide (UUID / contient `:`) → `INVALID_VALUE` au compile.
- **RC4** : `sourceKind: media.mic` sans `size` → valide (box d'aire nulle, inerte).
- **RC5** : un bundle **sans** capture produit un hash et un rendu identiques à avant l'ADR
  (non-régression des 9 primitives ; snapshot/golden inchangés).
- **RC6** : le runtime publie `x-zab.capture/1` dans sa liste de profiles supportés.
- **RC7** : fixtures de conformance RFC-0001 (`x-zab-capture-*`) vertes contre ce SDK.

---

## Amendment 1 — runtime context-aware (ACQUIRE / PLACEHOLDER)

- **Date** : 2026-06-23
- **Status** : accepted
- **Decided** : 2026-06-23
- **Author** : Atlas
- **Supersedes** : la §3.2 « Runtime » (rendu inerte partout). Le compiler (§3.1), la
  validation de forme, la frontière et les RC1/RC3/RC4/RC5/RC6/RC7 sont INCHANGÉS.

### A1.1 Pourquoi

Inerte-partout casse la preview cockpit : elle rend la scène uniquement via le webview Solar
du bundle (pas l'arbre React éditeur, pas le `use-live-source`), donc un nœud transparent +
rien derrière = écran vide. Le primitive doit acquérir le stream lui-même quand l'hôte le
peut. Implémente RFC-0001 Amendment 1 (A1.2/A1.3).

### A1.2 Runtime — détection de capability + 2 modes

`packages/runtime/src/render/primitives/capture.tsx` :

- **Capability detect au mount** : `navigator.mediaDevices?.getUserMedia` présent ET
  utilisable → ACQUIRE ; sinon PLACEHOLDER. Détection de feature, **pas** un flag d'env.
- **ACQUIRE** (webview preview, permissions media auto-grantées) : `getUserMedia`
  (webcam/mic) ou `getDisplayMedia` (screen/window) selon `x-zab.sourceKind` ; rend un
  `<video>` (kinds visuels) dans la box ; kinds audio = box vide. `deviceId` obtenu via le
  **resolver hôte** (A1.3), jamais baké. Toute erreur (pas de resolver, pas de device,
  permission refusée, échec) → repli PLACEHOLDER **sans** throw ni blanchir l'arbre.
- **PLACEHOLDER** (CEF/Pulsar antenne) : box transparente, n'acquiert rien — comportement
  d'origine de la §3.2, antenne **inchangée**.
- Cleanup : `MediaStream` arrêté (`getTracks().stop()`) au unmount / changement de scène.
- Aucun diagnostic pour le mode PLACEHOLDER ni pour un repli ACQUIRE→PLACEHOLDER.

### A1.3 Resolver hôte (`deviceRef → deviceId`) — injection, pas table interne

Le runtime n'embarque **aucune** table device. Il expose un point d'injection OPTIONNEL via
la config d'hôte (option de mount / champ de `SceneApp`, **pas** le bundle, **pas** le wire
LSDP) :

```ts
resolveCaptureDevice?: (deviceRef: string, sourceKind: string) => { deviceId?: string } | null
```

- Resolver fourni → ACQUIRE l'appelle, passe `{ deviceId }` en contrainte `getUserMedia`.
- Pas de resolver / retourne `null` → **DÉFAUT TRANCHÉ : `getUserMedia` sans `deviceId`**
  (device par défaut de l'hôte) plutôt que repli PLACEHOLDER — « la cam traverse » dès le
  1er jet, le mapping fin vient après. Jamais de throw.
- Le `deviceId` résolu ne touche NI le bundle NI le hash (contrainte runtime live seulement).

### A1.4 Re-découpe d'impact

- **A (lumencast-js)** : ajoute capability-detect + ACQUIRE/`<video>`/`getDisplayMedia` +
  cleanup tracks + l'option `resolveCaptureDevice` dans `capture.tsx` / la surface de mount.
  PLACEHOLDER conservé comme branche non-capable.
- **B (Prism)** : (i) fournir au webview Solar un `resolveCaptureDevice` OU le mapping
  `deviceRef→deviceId` — par **injection dans le bootstrap HTML du scene-server** main-side
  (canal `injectBootstrap` EXISTANT de `scene-server.ts`, `/scene/:id`), qui ne touche NI
  resolveTarget NI l'activation/rev (figé préservé) ; le mapping vient de `capture-devices.ts`
  (`resolveDeviceRef`, déjà en place). (ii) **Étendre l'auto-grant media à la session du
  webview preview** : `permissions.ts` n'enregistre les handlers que sur
  `session.defaultSession`, or le webview tourne en `partition="livepreview"` → enregistrer
  les mêmes handlers sur `session.fromPartition("livepreview")`, sinon ACQUIRE échoue en
  preview. (iii) à l'antenne : inchangé (PLACEHOLDER + source native Pulsar).
- **C (Solar)** : bump runtime vendored ; câbler `resolveCaptureDevice` depuis le payload
  bootstrap injecté → l'option de mount du runtime (l'adaptateur Solar reste mince).

### A1.5 RC ajoutés/révisés

- **RC2 (RÉVISÉ)** : en hôte NON-capable (pas de `getUserMedia` — simulé/CEF), le nœud rend
  une box transparente, 0 pixel, 0 acquisition, 0 diagnostic (= ancien RC2, mode PLACEHOLDER).
- **RC8** : en hôte capable (jsdom/headless avec `getUserMedia` mocké), le nœud entre en
  ACQUIRE, appelle `getUserMedia` une fois, monte un `<video>` avec le stream ; échec
  d'acquisition → repli PLACEHOLDER sans throw.
- **RC9** : un `resolveCaptureDevice` fourni est appelé avec le `deviceRef` LOGIQUE et son
  `deviceId` finit en contrainte `getUserMedia` ; resolver absent → `getUserMedia` sans
  `deviceId` (pas de throw, pas de PLACEHOLDER).
- **RC10** : le `deviceId` résolu n'apparaît dans AUCUN artefact bundle/hash (grep + golden).
- **RC11** : unmount/scène suivante → tracks `MediaStream` arrêtés (pas de fuite caméra).
