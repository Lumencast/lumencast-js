# ADR 002 — Transcription Figma→LSML sans perte : modèle de positionnement absolu + LSML 1.2 (effets, masques, image-fills)

- **Status** : accepted
- **Date** : 2026-06-17
- **Decided** : 2026-06-17
- **Deciders** : @ClodoCapeo
- **Author** : Atlas
- **Supersedes** : —
- **Superseded by** : —

> Exigence porteur, non négociable : « 0 information, 0 design, 0 écart » entre une frame
> Figma et son rendu LSML à l'antenne. Tranché par le porteur (2026-06-17) : **0-perte =
> 0-perte EN-LANGAGE** — ni rastérisation (perd l'éditabilité/l'intention paramétrique =
> une perte), ni acceptation de risque. Le langage doit exprimer les effets nativement.
> Référence de régression : scoreboard draft LCK/LEC (`bHkV7eVHul15NxhOFZvRHY` `49:721`,
> bug « carré rating »). Cible de conformance 0-perte stricte : cover Wellplayed
> (`gtCekQzHW0eBqx4ATVRAAw` `817:3`).

## Amendment 1 — Conditions de clearance Bastion 1.2 (2026-06-17)

Status inchangé (`accepted`) : amendement, pas re-décision. Le threat-model design de la surface
LSML 1.2 est livré (Bastion, 2026-06-17) → **CLEARANCE CONDITIONNELLE** (pas de veto). Cet
amendement grave les **6 conditions bloquantes T1–T6** (+ recommandation ferme T7, portée Keeper)
en §3.4 et les injecte comme **critères d'acceptation testables** sur les issues #C→#J (§7).
Le trou **T1** (allowlist d'hôtes déclarative non enforced, exploitable dès 1.1) est **fondu dans
la campagne 1.2** (issue #F, enforcement runtime+compiler prioritaire) — pas de patch standalone.
**#I** est repositionnée : threat-model FAIT → #I devient l'implémentation du **gate de validation
d'authoring** + la fixture sécu pathologique. Source verbatim :
`D:\Documents\.audit-lsml\bastion-conditions-1.2.md`. Le diagnostic racine, D1 (PR #56) et la
matrice ne sont pas touchés.

## Amendment 2 — Fermeture des 2 gaps 0-perte résiduels (shape-ref masks + per-fill blend) (2026-06-18)

Status inchangé (`accepted`) : amendement, pas re-décision. Le diagnostic racine, D1, D2/D3 et
les conditions Bastion T1–T7 ne sont pas touchés. Au merge de **#H** (mapper), deux constructions
restent droppées en `metadata.figma.*` — elles brisent le « 0-perte sur n'importe quoi » du porteur
et sont structurelles (pas un simple câblage de prop). Cet amendement les tranche et grave **#K**
(shape-ref masks + id stables) et **#L** (per-fill blendMode), insérées dans l'ordre de build avant
le harness **#J** (qui doit mesurer le 0-perte _avec_ ces gaps fermés).

### A2.1 — Gap 1 : masques par forme-source (`mask.source.kind:"shape"`) + id stables

**État réel (vérifié `lsml-types.ts` + `runtime/src/render/mask.tsx` origin/main).** Le schéma
`LSMLMask.source` prévoit déjà `{kind:"shape"; ref}` et `LSMLBaseNode.id?` existe. Le builder
`buildMask` émet déjà, pour une source forme, `<use href="#${safeIdRef(ref)}">` — `safeIdRef`
(`mask.tsx:76`) borne le ref à `[A-Za-z0-9_:-]+` (T3 préservé). **Ce qui manque** n'est donc pas le
builder mais **la chaîne de l'`id`** : (a) personne ne **génère** d'`id` stable sur les primitives
référençables, (b) rien ne **garantit** sa préservation mapper→compiler→`emit_lsml.go`→runtime, et
(c) le `<use href="#id">` est **pendant** — la forme cible n'est jamais rendue dans un `<defs>`
résoluble du même document SVG, donc le masque ne couvre rien. Décision :

1. **Génération d'id (mapper, #H-adjacent).** L'`id` d'une primitive référençable est **déterministe
   depuis l'id de nœud Figma** : `id = "fig-" + safeIdRef-sanitisé(figmaNodeId)` (les `:` de Figma
   comme `817:1991` sont déjà dans la classe `safeIdRef`, donc conservés tels quels). Déterministe ⇒
   **stable** entre deux transcriptions de la même frame et **unique** (l'id Figma l'est par
   construction). Le mapper n'émet un `id` que sur les nœuds **effectivement référencés** par un
   `mask.source.shape` du même bundle (pas d'inflation : 0 id sur les nœuds non référencés).
2. **Préservation à travers le pipeline.** `id` est un champ **déjà typé** de `LSMLBaseNode`
   (pas une prop opaque). À vérifier/garantir en #K : (a) il est dans l'allowlist de props
   (`prop-allowlist.ts`) pour ne pas être anti-droppé ; (b) `emit_lsml.go` le **préserve verbatim**
   (fixture round-trip : `id` présent en entrée ⇒ identique en sortie, comme T6 le fait déjà pour
   `allowedHosts`). On ne s'appuie **pas** sur le passage par metadata/props opaques pour `id`.
3. **Résolution runtime (le cœur structurel).** Le `Tree` construit, en une passe, un **index
   `id → géométrie de rendu`** des primitives portant un `id` (réutilise l'arbre déjà parcouru ;
   pas de second arbre). `buildMask`, pour une source forme, **ne référence plus une forme sibling
   hypothétique** : il **résout `ref` dans l'index** et **émet la géométrie résolue à l'intérieur du
   `<mask>`** via le **builder typé existant** (les primitives `shape`/`rect`/`circle`/`path` sont
   déjà construites élément-par-élément en React, `fill.tsx`/`primitives/shape.tsx`) — **zéro
   `innerHTML`, zéro `dangerouslySetInnerHTML`, T3 intégralement préservé**. Le `<use href>`
   pendant est abandonné au profit de l'**inlining de la géométrie résolue** : pas de dépendance à
   un `<defs>` global, le masque est auto-contenu.

**Invariants (gravés comme acceptance #K).**

- **Stabilité/unicité** : même frame Figma → même `id` à chaque run ; deux nœuds distincts → deux
  `id` distincts (test : transcription idempotente + collision-free sur `817:3`).
- **Ref pendante = omission, pas crash** : un `mask.source.ref` sans entrée dans l'index → masque
  **omis** + diagnostic à raison statique (R9, jamais l'`id`), sous-arbre rendu **non masqué** —
  `buildMask` ne throw jamais (invariant déjà tenu, étendu au cas ref-non-résolue).
- **Anti-cycle (condition Bastion, cf. A2.3)** : la résolution `ref → géométrie` ne **réentre
  jamais** dans le builder de masque de la forme résolue (on n'inline que sa **géométrie**, pas son
  éventuel propre `mask`). Un cycle `mask→shape→mask` est donc structurellement coupé — pas de
  récursion non bornée, pas de DoS. Profondeur de résolution **= 1** (une indirection), gravée comme
  invariant testable.

### A2.2 — Gap 2 : blend au niveau _paint_ (`blendMode` par entrée `LSMLFill`)

**État réel.** `blendMode` est aujourd'hui **par nœud** (`LSMLBaseNode.blendMode`, #D) → `mix-blend-mode`
sur le wrapper du nœud. Un nœud Figma à **fills empilés** porte un `blendMode` **par fill** (chaque
couche son mode) ; aujourd'hui seul le blend de nœud survit, les blends de fill individuels sont
droppés. Décision — **extension purement additive** :

1. **Schéma** : ajouter `blendMode?: LSMLBlendMode` (l'**enum fermé déjà existant**, A2 n'introduit
   aucune valeur nouvelle) sur **chaque variante** de l'union `LSMLFill` (solid/gradients/image).
   Rétro-compat totale : un fill **sans** `blendMode` = `normal` (comportement actuel inchangé ; un
   bundle 1.2 pré-#L reste valide).
2. **Runtime** : `fill.tsx` applique `mix-blend-mode` **par couche de fill** (chaque fill rendu dans
   sa propre couche reçoit son `mix-blend-mode`), indépendamment du `blendMode` de nœud qui reste
   appliqué au wrapper. Même rendu en `<defs>`/SVG pour les fills gradient/image.
3. **Mapper** : `mapping/shape.ts`/`color.ts` lowrent le `blendMode` de chaque paint Figma dans
   l'entrée `LSMLFill` correspondante (au lieu de le perdre / de ne garder que le blend de nœud).

**Invariants (acceptance #L).** Fill sans `blendMode` → `normal` (test rétro-compat) ; valeur hors
`LSMLBlendMode` → diagnostic + omission, **jamais passthrough** (T4, déjà gardé pour le blend de
nœud, étendu au blend de fill) ; double-gate compiler+runtime comme #D.

### A2.3 — Issues #K / #L et insertion dans l'ordre de build

- **#K (shape-ref masks + id stables — protocol + compiler + runtime + mapper, cross-stack)** —
  schéma : `id` référençable + acceptation `mask.source.kind:"shape"` côté protocol ; mapper :
  génération d'`id` déterministe sur nœuds référencés + lowering du `mask` shape-source ; compiler :
  `id` dans l'allowlist + forward + `emit_lsml.go` préserve `id` (round-trip) ; runtime : index
  `id→géométrie` dans le `Tree` + `buildMask` inline la géométrie résolue (builder typé, zéro
  innerHTML). **Acceptance** : A2.1 invariants (stabilité/unicité, ref-pendante=omission sans crash,
  anti-cycle profondeur=1) + T3 (aucun élément exécutable produit) + round-trip `817:1991` masque
  forme rendu non-perdu. **Place** : **après #H** (consomme le schéma compilé et le mapper 1.2),
  **avant #J**.
- **#L (per-fill blendMode — protocol + runtime + mapper)** — schéma : `blendMode?` additif sur
  chaque variante `LSMLFill` ; runtime : `mix-blend-mode` par couche de fill (`fill.tsx`) ; mapper :
  lowering du blend de paint. **Acceptance** : A2.2 invariants (rétro-compat fill-sans-blend=normal,
  T4 enum fermé + omission, double-gate) + round-trip `817:84`/`817:1994` blend de fill préservé.
  **Place** : **après #H**, **parallélisable avec #K** (modules disjoints : #K touche `mask.tsx` +
  index `Tree` + `id` ; #L touche `fill.tsx` + variantes `LSMLFill`), **avant #J**.

**Ordre mis à jour (§7).** Chemin critique inchangé jusqu'à #H. Puis : **#K ∥ #L** (après #H,
modules disjoints) → **#J** en dernier (le harness 0-perte `817:3` doit s'exécuter **avec** #K et #L
mergés, sinon il mesurerait une perte sur les masques forme-source et les blends de fill et
échouerait à prouver le 0-perte strict). #I (gate d'authoring) borne aussi #K/#L : le gate refuse un
`mask.source.ref` pendant et un `blendMode` de fill hors enum **avant l'antenne** (extension naturelle
de T4/T6, pas une condition nouvelle).

### A2.4 — Note pour Bastion (clearance #K/#L ciblée)

Ces deux extensions **n'ouvrent aucune surface d'attaque nouvelle** ; la clearance peut être ciblée :

- **#K (shape-ref)** : la `ref` est un **id interne** déjà sanitisé par `safeIdRef`
  (`[A-Za-z0-9_:-]+`, `mask.tsx:76`) — pas une URL, pas de réseau, pas de fetch. La résolution est
  **interne à l'arbre de rendu** (lookup en mémoire), et l'inlining réutilise le **builder typé
  React** (T3 : zéro `innerHTML`/`dangerouslySetInnerHTML`, élément-par-élément). Aucune nouvelle
  primitive de schéma exécutable, aucun nouveau canal d'I/O.
- **#L (per-fill blend)** : `blendMode?` réutilise **l'enum fermé existant `LSMLBlendMode`** (déjà
  gardé T4) — aucune valeur nouvelle, aucun string libre, aucune surface CSS nouvelle (même
  `mix-blend-mode` déjà rendu pour le blend de nœud).
- **Risque signalé comme condition (#K)** : référence **cyclique** `mask→shape→mask` (DoS par
  récursion non bornée). **Coupé par design** (A2.1 invariant anti-cycle : profondeur de résolution
  = 1, on n'inline que la géométrie, jamais le `mask` de la forme résolue). À **confirmer par test**
  Bastion : une fixture cyclique pathologique (et une chaîne `mask→shape→mask→…` longue) ne provoque
  **ni récursion ni freeze** — à intégrer dans la fixture sécu de #I (budget de complexité T5).

## Amendment 3 — SVG-en-asset 0-perte ET sans faille (restaure le drop XSS) (2026-06-18)

> Statut ADR inchangé (`accepted`). Auteur : Atlas. Deciders : @ClodoCapeo (validation
> amendement : Vigil ; contrat sanitizer N2 : Bastion, gated). Déclencheur : le fix d'urgence
> `fcc6d79` (mergé, ferme la XSS Bastion VETO sur #H/PR #8) **droppe désormais tout asset SVG**
> (`assets.ts:28` `RASTER_DATA_URI_EXTS` = png/jpg/gif/webp ; branche svg morte, warning muet).
> Ça ferme la faille mais **viole le mandat 0-perte** : un SVG placé en image-fill disparaît.
> Cet amendement restaure le SVG **proprement** sans rouvrir la surface.

### A3.1 — Cartographie : QUAND/POURQUOI le pipeline produit des bytes SVG

**Fait établi (scope code).** Il n'existe **aucun** `exportAsync(format:"SVG")` dans le mapper
(`grep` exhaustif : zéro). Les vrais vecteurs Figma sont **déjà** décomposés en géométrie native
LSML : `mapping/shape.ts:112-134` mappe VECTOR/BOOLEAN_OPERATION/STAR/POLYGON/LINE →
`geometry:"path"` via `fillGeometry`/`vectorPaths` → `paths[]`/`pathData` (LSML 1.1 §4.6). **Les
vecteurs natifs ne sont donc PAS la source du SVG-en-asset.**

L'**unique porte** par laquelle des bytes SVG entrent : une **IMAGE paint** Figma (`paint.type ===
"IMAGE"` avec un `imageHash`) dont les bytes sous-jacents sont du SVG. Figma autorise un SVG importé
à être posé comme **remplissage-image** (un asset bitmap-like, **non décomposé** en vecteurs) — typiquement
un logo/pictogramme `.svg` importé et utilisé comme fill, ou un groupe complexe/texte vectorisé/masque
aplati que l'auteur a importé sous forme d'image SVG plutôt que de l'avoir collé en calque vectoriel.
Ces bytes ne sont résolus qu'à `finalize()`, via `getImageByHash(hash).getBytesAsync()`.

**Les 3 sites exacts (fichier:ligne) qui inscrivent un `imageHash` → data-URI** (le périmètre à traiter) :

1. `mapping/shape.ts:77-88` — IMAGE paint d'une shape → `imagePaintToFill` (`mapping/lsml-1_2.ts:101`)
   → `registerImageHashAsDataUri`. Fill `{kind:"image",src}`.
2. `mapping/frame.ts:102-110` — IMAGE paint d'un frame → background `{kind:"image",src}` →
   `registerImageHashAsDataUri`.
3. `mapping/traverse.ts:246,277-287` (`maskImageSrc`) — IMAGE paint d'un nœud `isMask` → `mask.source
{kind:"image",src}` → `registerImageHashAsDataUri`.

**Le point unique de matérialisation** (et le seul endroit où le SVG est aujourd'hui droppé) :
`export/assets.ts:135-161` `finalize()` → bloc `dataUriByHash`. Le sniff (`sniffImageExtension`,
`assets.ts:275`) ne reconnaît que les magic-bytes raster ; tout SVG tombe en `"bin"`, échoue
`RASTER_DATA_URI_EXTS.has(ext)` (`assets.ts:151`), émet `asset-data-uri-omitted` et **le fill/mask
référent est élagué** (`applyAssetPathRewrites`, `assets.ts:223-271`). C'est **la perte**.

> Conséquence d'architecture : il y a **un seul choke-point** (`finalize` data-URI) pour
> matérialiser un SVG, et **trois sites de registration** homogènes. On traite le SVG **au
> choke-point**, pas dans chaque mapper — les mappers restent inchangés.

### A3.2 — Niveau 1 (préféré, 0 image, 0 surface) : décomposition en géométrie native

Pour chaque cas SVG scopé en A3.1, **la décomposition native est-elle possible ?** Réponse
**partielle**, et c'est la frontière clé :

- **Décomposable** : un SVG **purement géométrique** (paths/rect/circle/ellipse/polygon/line +
  remplissages plats/dégradés linéaires) posé en image-fill **n'a aucune raison d'être une image**.
  On l'exprime en `shape` LSML natif (`geometry:"path"` + `paths[]`/`pathData`, §4.6) — exactement
  le canal que `shape.ts` produit déjà pour les vecteurs Figma. **0 image, 0 data-URI, 0 surface.**
  La géométrie aplatie est obtenue en parsant le `<path d="…">`/primitives du document SVG et en
  émettant des `ShapePathEntry{data,windingRule}` — pas en réembarquant le SVG.
- **NON décomposable en path natif** : un SVG qui porte de la **rastérisation** (`<image>` bitmap
  embarqué), des **filtres/effets** non exprimables en LSML 1.2, du **texte non vectorisé** (glyphes
  dépendant d'une font), des **patterns/clip imbriqués** au-delà du modèle `mask` LSML, ou des
  **dégradés non-linéaires hors §4.2**. Ceux-là ne peuvent pas devenir un `shape` natif sans perte
  de rendu → ils relèvent du Niveau 2.

**Décision N1.** Au choke-point `finalize`, quand les bytes sniffent SVG (signature
`<svg`/`<?xml`+`<svg`, pas l'extension), tenter une **décomposition geometry-only** : parser le
document, et **si et seulement si** il est intégralement réductible à des primitives géométriques
LSML supportées (paths + fills §4.1/§4.2 + le sous-ensemble couvert par §4.6), réémettre le fill/mask
référent **non plus comme `{kind:"image",src:data:}` mais comme géométrie native** (shape path, ou
`mask.source.kind:"shape"` via le canal #K déjà décidé en A2.1). **Aucun data-URI, aucun MIME SVG.**
Un fragment non réductible (un seul élément hors-allowlist géométrique) → **échec de N1**, on passe
à N2 (jamais une décomposition partielle silencieuse qui perdrait le reste).

> N1 est un **mapper-side concern** : la réémission native doit produire une primitive `shape`
> remontée comme tout autre nœud. Comme le choke-point est en `export/`, N1 vit dans un module
> dédié `export/svg-decompose.ts` (parse SVG → primitives LSML) appelé par `finalize`, qui peut
> **muter le fill/mask référent** via le même walker de rewrite que l'omission utilise déjà
> (`applyAssetPathRewrites`) — au lieu de supprimer la référence, il la **remplace** par la
> géométrie. Pas de nouvelle dépendance réseau ; parse pur in-process.

### A3.3 — Niveau 2 (dernier recours, SVG irréductible) : sanitizer geometry-only

Pour le SVG **irréductible** (A3.2), on n'a d'autre choix que de **conserver un SVG**. Il ne peut
réapparaître qu'**assaini**. Architecture (le **contrat de sécurité détaillé est posé par Bastion**,
pas ici) :

- **Principe : parse-then-rebuild typé, JAMAIS regex-strip.** On parse le SVG en arbre, on
  **reconstruit** un nouveau document à partir d'une **allowlist stricte d'éléments/attributs
  purement géométriques** (`svg, g, path, rect, circle, ellipse, line, polyline, polygon, defs,
linearGradient, radialGradient, stop, clipPath, mask` + attributs de pure géométrie/peinture :
  `d, x, y, width, height, cx, cy, r, rx, ry, points, transform, fill, stroke, stroke-width,
fill-rule, opacity, viewBox, offset, stop-color, gradientUnits, gradientTransform`). Tout le reste
  est **non porté** (drop dur de l'élément/attribut, pas masqué) — l'allowlist exacte est le livrable
  Bastion.
- **Suppression dure (structurellement impossible de survivre)** : `script`, `foreignObject`,
  `style`, `animate*`/`set` (SMIL), tout attribut event-handler (`on*`), tout `href`/`xlink:href`
  **externe** ou `use` externe, toute URL non-`data:` géométrique. Garantie par construction
  (rebuild = on ne copie que ce qui est dans l'allowlist), **pas** par filtrage a posteriori.
- **Où il vit** : module `export/svg-sanitize.ts` (mapper, in-process, zéro réseau), appelé par
  `finalize` **après** échec de N1, **avant** toute émission de data-URI. Pas dans le runtime :
  on assainit **à l'authoring/export**, jamais au host CEF (doctrine porteur : sûreté au gate ; le
  runtime reste défense en profondeur, cf. T6).
- **Output** : un **SVG reconstruit** réembarqué en `data:image/svg+xml;base64,…`. **La
  réintroduction du MIME `image/svg+xml` n'est admissible QUE derrière ce sanitizer
  Bastion-validé** : `RASTER_DATA_URI_EXTS` n'est **PAS** rouvert à `svg` ; à la place, le chemin SVG
  emprunte une fonction distincte qui n'émet un `data:image/svg+xml` **que sur la sortie du
  sanitizer** (jamais sur des bytes bruts). Tout `data:image/svg+xml` non issu du sanitizer reste
  interdit dur. (Bastion peut préférer re-convertir en LSML plutôt que réembarquer du SVG : ce choix
  — SVG assaini réembarqué vs re-conversion — est **arbitré dans sa clearance** ; l'architecture
  supporte les deux car le choke-point est unique.)

### A3.4 — Invariant 0-perte vs sécurité : que faire de l'irréductible non assainissable

**Tranche.** L'ordre de traitement au choke-point est : **N1 (décompose natif) → N2 (sanitize) →
échec visible**. Trois sorties, **aucune perte silencieuse** :

1. N1 réussit → géométrie native, 0 surface. **Cas par défaut visé.**
2. N1 échoue, N2 produit un SVG assaini non vide → `data:image/svg+xml` assaini réembarqué.
3. N1 et N2 échouent (SVG vide après assainissement, ou parse impossible) → **échec d'authoring
   visible**, PAS un drop muet. Le diagnostic actuel `asset-data-uri-omitted` (warning) est
   **promu en erreur de gate d'authoring** (`error`, pas `warn`) : le bundle est **refusé à
   l'antenne** par le gate T6/#I tant que l'auteur n'a pas corrigé la source (revectoriser dans
   Figma, ou retirer l'asset). **Le mandat 0-perte interdit qu'un asset disparaisse sans que
   l'auteur le sache et puisse agir** — un échec bruyant au gate respecte le 0-perte (rien n'est
   perdu en silence) ET la sécurité (rien d'exécutable ne passe). Le silence (`fcc6d79`) est
   précisément ce qui est rejeté.

> Cohérence avec A3.2/A3.3 : un fragment partiellement réductible ne produit **jamais** une
> décomposition tronquée — soit tout passe en N1, soit l'objet entier bascule en N2, soit il échoue
> bruyamment. Pas de demi-rendu.

### A3.5 — Découpage en issues (insertion dans l'ordre §7)

- **#M (N1 — décomposition SVG-asset → géométrie native ; mapper, `export/`)** — module
  `export/svg-decompose.ts` : parse d'un document SVG géométrique → primitives LSML (`shape`
  path/`mask.source.kind:"shape"`) ; intégration au choke-point `finalize` (`assets.ts`) :
  détection signature SVG, tentative de décomposition, **réémission** du fill/mask référent en
  géométrie native (réutilise/étend le walker `applyAssetPathRewrites` pour **remplacer** au lieu
  d'omettre). **Acceptance (testable)** : (a) un SVG purement géométrique en image-fill produit un
  `shape{geometry:"path",paths|pathData}` rendu **identique** au SVG source (round-trip pixel/path),
  **0 data-URI émis** ; (b) `data:image/svg+xml` **absent** du bundle pour ce cas ; (c) un SVG
  comportant **un seul** élément hors-allowlist géométrique **ne décompose pas** (bascule N2/#N) et
  ne produit **aucune** décomposition partielle ; (d) anti-drop : le fill/mask n'est plus élagué
  pour un SVG décomposable. **Place** : **après #H** (consomme le mapper 1.2 + le canal shape-mask
  #K pour `mask.source.kind:"shape"`), **parallélisable avec #K/#L** si #K déjà mergé pour le cas
  mask. **Indépendant de #N** pour le cas shape/frame ; **dépend de #N** uniquement pour fermer le
  fallback.
- **#N (N2 — sanitizer SVG geometry-only ; mapper, `export/`)** — module `export/svg-sanitize.ts` :
  parse→rebuild typé sur allowlist stricte (livrée par Bastion), suppression dure
  script/foreignObject/style/SMIL/`on*`/href externe/`use` externe ; fonction d'émission dédiée
  `data:image/svg+xml` **uniquement** sur sortie sanitizer ; appelée par `finalize` **après** échec
  #M, **avant** émission ; promotion du diagnostic de drop en **erreur de gate** (A3.4 cas 3).
  `RASTER_DATA_URI_EXTS` **non modifié** (svg ne le rejoint pas). **Acceptance (testable)** : (a)
  une fixture SVG malveillante (`<script>`, `onload=`, `<foreignObject>`, `xlink:href` externe,
  `<use href=ext>`, `data:text/html`) produit un SVG assaini **sans aucun** de ces éléments/attributs
  (assertion par parse du résultat, pas regex) ; (b) **aucun** `data:image/svg+xml` n'est émis hors
  sortie sanitizer (test : bytes SVG bruts → jamais de data-URI svg direct) ; (c) un SVG vide après
  assainissement → **erreur de gate** (bundle refusé), pas un drop silencieux ; (d) le contrat
  Bastion (allowlist exacte + cas de suppression) est intégralement couvert par tests. **Place** :
  **après #H**, **avant #I** (le gate d'authoring doit pouvoir refuser le cas 3 de A3.4) ; **#M
  s'appuie sur #N pour le fallback** → #N peut précéder ou être co-livré avec #M.

**Ordre mis à jour (§7).** Chemin critique inchangé jusqu'à #H. Puis : **#K ∥ #L** (A2.3) puis
**#N → #M** (ou #M∥#N avec #M qui no-op sur le fallback tant que #N absent ; le 0-perte strict
n'est prouvé qu'avec **les deux** mergés), le tout **avant #I** (le gate consomme l'erreur A3.4)
et **avant #J** (le harness 0-perte `817:3` doit s'exécuter avec #M+#N mergés, sinon il mesurerait
la perte SVG actuelle). **Tant que #N n'est pas mergé et Bastion-validé, la surface `image/svg+xml`
reste fermée** : `fcc6d79` (drop) demeure le comportement, mais avec le diagnostic promu en erreur
de gate (#M peut livrer cette promotion dès le cas shape, sans rouvrir le MIME).

### A3.6 — Note pour Bastion (clearance gated — contrat sanitizer #N)

> **Ne pas rouvrir la surface SVG sans #N Bastion-validé.** La réintroduction de `image/svg+xml`
> est subordonnée à la clearance Bastion sur le contrat du sanitizer. Spawn gated (coût).

À poser par Bastion (ce que l'architecture **n'**arbitre **pas** et lui délègue) :

1. **L'allowlist exacte** d'éléments/attributs géométriques admis au rebuild (A3.3 donne le point de
   départ, Bastion la fige et la justifie contre la surface T2/T3).
2. **Le choix output** : SVG assaini réembarqué en `data:image/svg+xml` **vs** re-conversion en
   LSML (le choke-point unique supporte les deux ; Bastion tranche selon le risque résiduel d'un SVG,
   même assaini, au host CEF — interaction avec T7/CSP).
3. **Le verdict parse-then-rebuild** : confirmer que le rebuild typé (zéro copie d'inconnu) rend
   `script`/`foreignObject`/`on*`/href externe **structurellement impossibles** (analogue de
   l'interdit `innerHTML` T3, transposé du runtime à l'export) ; refuser tout sanitizer regex-based.
4. **Fixtures sécu** : la batterie malveillante (#N acceptance (a)) + une fixture SVG **pathologique
   anti-DoS** (profondeur/nombre d'éléments) intégrée au budget de complexité **T5/#I** — un SVG
   géant ne doit pas freezer le parse à l'export.
5. **Surface data-URI** : valider que la fonction d'émission `data:image/svg+xml` est
   **inaccessible** sauf sur sortie sanitizer (revue du call-graph : aucun chemin bytes-bruts→data-svg).

Cohérence avec l'existant : ceci **étend** T2 (schéma d'URL — `data:image/*` borné « si justifié » :
le SVG assaini est le cas justifié, sous condition sanitizer) et T3 (zéro markup SVG arbitraire du
bundle — ici l'arbitraire est éliminé **à l'export** par rebuild typé). Aucune des 6 conditions
existantes n'est relâchée ; #N en est une **précondition** au déverrouillage du MIME SVG.

## Amendment 4 — Masques dont la source est un GROUP/FRAME (composite multi-enfants 0-perte) (2026-06-18)

Status inchangé (`accepted`) : amendement, pas re-décision. Ferme le **dernier** écart du
structural-diff de `817:3` (**2 résiduels, même cause racine**). Étend le canal #K (source forme)
au cas — non couvert — où **le masque Figma est porté par un GROUP/FRAME**, pas une forme unique.

### A4.1 — Diagnostic racine (vérifié sur le vrai `817:3`, code origin/main)

Le masque résiduel est porté par un **GROUP** Figma `817:2011` (groupe de 4 ellipses dont une
visible `817:2014`, masquant `817:2016` + la pavage vectorielle `817:2017`). La chaîne #K ne lower
un shape-mask que si le nœud devient `kind:"shape"` :

- **Mapper** (`mapping/traverse.ts:applyImageMaskGroups`) : la branche shape-mask est gardée par
  `result.node.kind === "shape"`. Un GROUP/FRAME → `kind:"frame"` ⇒ on tombe dans le `else` (sibling
  normal, `mask` jamais posé).
- **Runtime** : `shape-index.tsx:buildShapeIndex` n'indexe **que** `kind:"shape"` ;
  `buildMaskCoverageFromShape` retourne `null` si `node.kind !== "shape"` ; `resolveShape`
  (`tree.tsx`) ne produit **qu'une seule** géométrie. Aucun chemin pour un container à N enfants.

C'est l'**extension #K** : _source de masque = groupe/frame_, couverture = **composite des géométries
des enfants visibles**. Les 2 résiduels du diff partagent cette unique cause.

### A4.2 — Options examinées et verdict

- **Option 1 — décomposer vers la seule ellipse visible (`817:2014`).** Marche pour CE cas mais
  **viole le mandat 0-perte général** : un group-mask à plusieurs enfants visibles perdrait toute
  couverture sauf la première. **Écartée** (pas 0-perte structurel ; corrige le symptôme, pas la
  classe).
- **Option 3 — choisir luminance vs alpha selon le cas.** Faux problème ici : `maskType` est déjà
  mappé (`mapMaskType`, `alpha`|`luminance`) et préservé sur le `mask` ; le canal du composite est
  **orthogonal** à la source group/frame. Aucune décision nouvelle à prendre — **non pertinente**.
- **Option 2 — vrai support group/frame comme source de masque (composite).** Couverture du masque =
  **union des alphas** de la géométrie des enfants **visibles** du container. **Retenue** :
  0-perte général, et c'est l'extension _naturelle et minimale_ de #K (même modèle d'id stable,
  même résolution interne par index, même builder typé, même invariant anti-cycle). **Verdict : GO.**

### A4.3 — Décision (extension de schéma + mapper + runtime + emit)

1. **Schéma (protocol) — `MaskSource` étendu, additif.** Ajouter une 3ᵉ variante à l'union
   `LSMLMask.source` : `{ kind: "group"; ref: string }`. `ref` = id stable du **nœud container**
   (mêmes bornes `safeIdRef` que #K : `[A-Za-z0-9_:-]+`). Rétro-compat totale : `shape`/`image`
   inchangés ; un bundle pré-A4 reste valide. **Pas de `kind:"frame"` distinct** : un FRAME masque et
   un GROUP masque se résolvent identiquement (composite des enfants visibles) — une seule variante
   `group` couvre les deux containers Figma (évite l'inflation d'enum, T4).
2. **Mapper (`traverse.ts`).** Quand `isMaskNode` et `result.node.kind` ∈ `{frame}` (container — un
   GROUP transparent et un FRAME lowrent tous deux en `frame`) : émettre l'`id` stable
   `stableShapeId(src.id)` **sur le nœud container** (réutilise la fonction #K, zéro nouvelle
   génération d'id), poser `activeMask = {source:{kind:"group", ref:id}, type:mapMaskType(...), op}`,
   **garder le container dans l'arbre** (le runtime l'indexe pour descendre). Aucun id sur les
   enfants (pas d'inflation : seul le container référencé porte un id). Le cas `kind:"shape"` (#K)
   est inchangé ; ce bloc est un `else if` ajouté **avant** le fallback sibling.
3. **Runtime — index.** `buildShapeIndex` (renommage conceptuel : _referenceable-node index_) indexe
   désormais **aussi** les nœuds `kind:"frame"` portant un `id` (en plus des `shape`). L'invariant
   d'unicité, l'ordre « première occurrence gagne » et le diagnostic de collision sont inchangés.
4. **Runtime — composite.** Nouveau `buildMaskCoverageFromGroup(node, nodeId)` (sœur de
   `buildMaskCoverageFromShape`) : itère `node.children`, et pour **chaque enfant visible**
   (`visible !== false`) **de géométrie résolvable** (un `shape` → `buildShapeOutline` en coverage
   blanche ; un sous-container → descente bornée, cf. anti-cycle) émet sa coverage ; **enveloppe
   l'ensemble dans un `<g>`** typé. Union des alphas = empilement des coverages blanches dans le même
   `<mask>` (l'alpha cumulé d'un `<mask>` est l'union — comportement SVG natif, aucun string libre).
   `resolveShape` (`tree.tsx`) route sur `node.kind` : `shape`→coverage forme, `frame`→composite
   groupe. **Builder 100 % typé, zéro `innerHTML`/`dangerouslySetInnerHTML` (T3).**
5. **Compiler / `emit_lsml.go`.** `id` est déjà préservé verbatim (#K, round-trip T6) sur **tout**
   `LSMLBaseNode` — donc déjà valable pour un `frame`. La 3ᵉ variante `source.kind:"group"` doit
   entrer dans l'allowlist/validation du `mask.source` côté compiler (extension de l'enum fermé #K) et
   passer `emit_lsml.go` round-trip (fixture : `mask.source.kind:"group"` bytes-stable).

### A4.4 — Invariants (gravés comme acceptance #O)

- **Composite = union des enfants visibles.** Un group-mask à N enfants visibles → la couverture est
  l'**union** de leurs géométries (test : 2 enfants visibles disjoints → les deux zones masquent).
- **`visible:false` exclu.** Un enfant du container masque avec `visible:false` **ne contribue pas**
  à la couverture (test). Les 3 ellipses non visibles de `817:2011` n'élargissent pas la couverture.
- **Anti-cycle, profondeur = 1 (condition Bastion, cf. A2.4).** La résolution `ref → container`
  inline la **géométrie des enfants directs**, **jamais le `mask` propre** d'un enfant ni du
  container. Un container imbriqué (group dans group masque) est borné par un **cap de descente T5**
  (profondeur structurelle de composite plafonnée, défaut = 1 niveau de container ; au-delà →
  diagnostic + on s'arrête, pas de crash). Un cycle `mask→group→…→mask` est structurellement coupé
  (on n'inline jamais un `mask`).
- **Ref pendante / container vide = omission, pas crash.** `ref` absent de l'index, ou container
  sans enfant visible résolvable → masque **omis** + diagnostic à raison statique (R9, jamais l'`id`),
  sous-arbre rendu non masqué. `buildMask` ne throw jamais (invariant #K étendu).
- **Budget de complexité (T5).** Un container à très grand N (cap explicite, p. ex. `817:2017` ≈ 190
  tuiles si jamais utilisé comme masque) → composite **borné** ; au-delà du cap → diagnostic +
  troncature, jamais de freeze. À couvrir par fixture pathologique dans le harness sécu #I.

### A4.5 — Issue #O et insertion dans l'ordre (§7)

- **#O (group/frame-source masks — protocol + compiler + runtime + mapper, cross-stack)** — schéma :
  3ᵉ variante `source.kind:"group"` + validation compiler ; mapper : id stable sur container + lowering
  `mask` group-source + container gardé dans l'arbre ; runtime : index étendu aux `frame`,
  `buildMaskCoverageFromGroup` (composite enfants visibles, anti-cycle + cap descente), routage
  `resolveShape` ; emit : round-trip `source.kind:"group"`. **Acceptance** : A4.4 invariants +
  structural-diff `817:3` = **0** (les 2 masques résiduels lowered) + T3 (aucun élément exécutable).
  **Place** : **après #K** (le réutilise intégralement), **avant #J** (le harness 0-perte strict
  `817:3` doit s'exécuter **avec** #O, sinon il mesurerait la perte des 2 masques group-source).
  #I (gate d'authoring) borne #O : refuse un `mask.source.ref` group pendant et un container au-delà
  du cap T5 **avant l'antenne** (extension de T4/T5, pas une condition nouvelle).

### A4.6 — Note pour Bastion (clearance #O ciblée)

**Aucune surface d'attaque nouvelle au-delà de #K.** La `ref` reste un **id interne sanitisé**
(`safeIdRef`), pas une URL, pas de réseau, pas de fetch ; la résolution est un **lookup mémoire** dans
l'arbre de rendu ; le composite réutilise le **builder typé React** (T3 : zéro `innerHTML`,
élément-par-élément). Aucune primitive de schéma exécutable, aucun canal d'I/O nouveau. La 3ᵉ variante
`source.kind:"group"` reste un **enum fermé** (T4).

Deux risques **posés en condition** (à confirmer par fixture Bastion, intégrée au budget T5/#I) :

1. **Group-mask cyclique** (`mask→group→…→mask`) : coupé par design (on n'inline jamais un `mask` ;
   descente de composite bornée). À prouver : une fixture cyclique + une chaîne de containers profonde
   ne provoquent **ni récursion ni freeze**.
2. **Explosion de composite** (container à très grand N, ou imbrication profonde) : borné par le **cap
   de descente + cap de N** (A4.4 budget T5). À prouver : un container pathologiquement large/profond
   est **tronqué avec diagnostic**, jamais servi en composite non borné.

**Clearance Bastion gated requise au merge du code #O** (T3 + anti-cycle/budget) — spawn confirmé par
Eleven/utilisateur (coût). Si l'un de ces deux risques n'est pas tenu par les fixtures, le merge est
bloqué (veto levable par fix ou acceptation de risque écrite ici).

## 1. Context

ADR 001 a refermé la dette **runtime/compiler vs LSML 1.1** (paths, typo, `clipsContent`,
`bindAnimate`, anti-drop) et a ouvert un RFC LSML 1.2 pour effets/masques/blend modes
(ADR 001 §7.2, RC#9). Le porteur constate néanmoins des écarts visibles sur des scènes
reproduites. Audit code (Atlas, 2026-06-17) sur la chaîne complète
`mapping/` (Figma→LSML) → `@lumencast/compiler` → Orion `emit_lsml.go` → `@lumencast/runtime`.

Deux familles de perte, **strictement distinctes**, sont prouvées :

### 1.1 Lacune de modèle de layout (cause racine du « carré rating ») — bloquant, langage

Le Rating_Block est un **frame Figma non-auto-layout** (50.2×50.2) dont les 2 enfants `text`
(« RATING » @ 13.1,8.68 ; « 8 » @ 18.1,19.5) sont **positionnés en absolu**. La transcription
les porte correctement : `mapText` émet `position:{x,y}` parent-relatif
(`mapping/text.ts:121-127`), `mapShape` idem (`mapping/shape.ts:111-117`), `mapFrame` émet
`size` + `background` (`mapping/frame.ts:78-127`). **La perte est entièrement en aval, au
rendu** :

- **a)** `position` n'est PAS dans l'allowlist de props de `text` ni de `shape`
  (`packages/runtime/src/render/prop-allowlist.ts:47-76` — seuls `image` et `instance` listent
  `position`). Conséquence directe : tout `position` sur un `text`/`shape` est rejeté avec un
  diagnostic anti-drop et **jamais appliqué**.
- **b)** Le `Tree` n'extrait jamais `position`/`x`/`y` dans le bloc `universal`
  (`packages/runtime/src/render/tree.tsx:97-103` : il ne lit que `visible`,
  `universal_opacity`, `rotation`, `sizing`). `UniversalWrapper` n'a aucun champ position
  (`universal-wrapper.tsx:21-26`).
- **c)** Le `Frame` se pose lui-même en `position:absolute; left:0; top:0` et rend `{children}`
  **sans wrapper de placement par enfant** (`primitives/frame.tsx:55-83`). Les enfants `text`
  sont des `<span display:inline-block>` (`primitives/text.tsx:105-107`), `shape` des `<svg>` —
  tous **en flux normal**, empilés au coin haut-gauche du frame.

Résultat : les deux textes du carré rating se superposent en haut-gauche au lieu de tomber à
(13,8) et (18,19). C'est **structurellement** vrai pour _tout_ frame non-auto-layout à enfants
absolus — toute la moitié « composition libre » de Figma. **Le fill coloré du frame, lui, est
correctement rendu** (`frame.background`/`backgrounds` sont dans l'allowlist et consommés,
`frame.tsx:39-72`) ; le bug « carré rating » est donc **uniquement** la perte du layout interne,
pas du fond. Le diagnostic du porteur (« layout manquant dans le carré coloré ») est exact à la
lettre.

> Classement : **lacune de langage de positionnement au rendu**. LSML _a_ le champ
> `position:{x,y}` au schéma (§5.4, `lsml-types.ts:152-153`) mais **aucun primitif conteneur
> n'établit de coordonnées absolues pour ses enfants** et l'allowlist+wrapper le jettent. Le
> langage _décrit_ la position ; le runtime ne l'_honore_ pas. C'est le défaut le plus grave et
> le plus transverse de la chaîne.

### 1.2 Lacune de langage core : effets / masques / blend / image-fills (cause des écarts cover)

Le plugin **capture fidèlement** dans `metadata.figma.*` (profil `x-figma.authoring/1`) :
effets (drop/inner shadow, blur, noise, texture, glass — `mapping/figma-extras.ts:435-570`),
blend modes (`:214-222`), flag de masque + type (`:225-229`), per-corner radii (`:244-254`),
strokes avancés, image-fills de frame (`mapping/frame.ts:109-121`, `metadata.figma.imageBackgrounds`)
et de shape (`mapping/shape.ts:64-68` filtre les paints IMAGE → **droppés du Fill**). **Mais** :

- ADR 001 §3.1 (D1) a tranché : le profil authoring est **remonté en core, pas implémenté au
  runtime**. Le runtime **ignore** `metadata` (`lsml-types.ts:154` : « Runtime ignores »). Donc
  **toute** ombre/flou/blend/masque/image-fill capturé est **travail mort au rendu**.
- LSML core n'a **aucune** primitive/prop pour : ombre, flou statique, blend mode, masque par
  forme arbitraire (seul `clipsContent` = clip rectangulaire au `size`), image-fill sur shape
  (`image` est un primitif séparé, pas un fill), gradient angular/diamond (droppé `color.ts`),
  gradient transform complet (réduit à `angle_deg`, `color.ts:94-106`).

> Classement : **lacune de langage core**. Le mapper _peut_ tout capturer ; le format core ne
> _peut pas_ l'exprimer de façon rendable → le runtime ne peut rien en faire. C'est l'objet du
> RFC LSML 1.2 déjà ouvert par ADR 001 RC#9, ici **promu en décision d'implémentation**.

> **Faits concrets `817:3` (`get_design_context` réel, 2026-06-17).** Ce qu'on appelait
> « glass/noise/texture » n'est **pas** du procédural exotique — c'est exactement la matière
> de 1.2 D2/D3, prouvée nœud par nœud :
>
> - **blend modes** : `mix-blend-hard-light` sur `817:84` (Ruby20, image fond) et `817:1994`
>   (wavy shape) → `blendMode` core.
> - **masque** : `817:1991` « Mask group » = masque **alpha par image/forme**, op booléenne
>   **intersect**, avec position/size (`mask-alpha mask-intersect`) → `mask` core (pas un clip rect).
> - **image-fills** : `817:84`, `817:1174`, `817:1992/1994` = images **dans des formes**
>   (`object-cover`) → image-fill première classe + `object-fit`.
> - **texture** : `817:2017` = ~190 tuiles, **chacune une simple `<img>`** (asset bitmap), **pas**
>   un primitif procédural → lossless en gardant la structure (cf. §3.5).
> - **gradient** : `WP Gradient` réduit aujourd'hui à `angle_deg` → transform à étendre.
>
> **Conséquence** : le 0-perte strict de cette cover est atteignable **EN-LANGAGE** via le plan
> additif 1.2, **sans aucune rastérisation**. Cela ferme R5 (cf. §3.5, §5).

### 1.3 Lacunes de transcription pures (le langage peut, le mapper droppe/dégrade)

- **Image-fill de shape** : `mapping/shape.ts:65` filtre `p.type !== "IMAGE"` → l'image d'une
  forme (rounded-rect « Ruby20 »/« texture » de la cover) **n'est ni un Fill ni capturée comme
  imageBackground** (contrairement au frame). Perte sèche de l'asset sur shape. _(transcription)_
- **Gradient transform** : `paintToFill` réduit la matrice 2×3 à `angle_deg`
  (`color.ts:124`), perdant translation/scale/shear ; la matrice brute est stashée en
  `metadata.figma.gradientTransforms` (`shape.ts:128-133`) mais **ignorée au runtime**. Rendu
  approximatif. _(langage core — `LSMLFill` n'a pas de transform ; le RFC doit l'ajouter)_
- **BOOLEAN_OPERATION non-UNION** : subtract/intersect/exclude perdent l'opération au rendu
  non-Figma (`traverse.ts:161-173, 302-325` — fidélité structurelle conservée, fidélité
  visuelle perdue). _(langage core)_
- **Pavage ~190 tiles** (cover) : représenté à plat, 190 nœuds. **Pas une perte** d'information
  (chaque tile round-trip), mais coût bundle ; `repeat` est une liste data, pas un pavage
  géométrique figé → ne s'applique pas. Décision : accepter le pavage à plat (cf. §3.5). _(ni
  l'un ni l'autre — non-problème, documenté pour fermer la question)_

## 2. Decision drivers

1. **0-perte EN-LANGAGE est l'exigence dure.** Tout écart visible entre `49:721`/`817:3` et
   l'antenne est un échec. La preuve de « fini » est un round-trip rendu, pas un round-trip de
   bytes. **Tranché porteur (2026-06-17) : ni rastérisation, ni acceptation de risque** — le
   langage doit exprimer chaque effet nativement. La rastérisation aplatit l'intention
   paramétrique (couleur de marque, masque éditable, image-fill recadrable) = une perte, donc
   exclue. Les faits `817:3` (§1.2) montrent que c'est tenable sans aplatir.
2. **Séparer langage et transcription.** Un fix mapper ne sert à rien si le runtime jette la
   donnée ; une extension de schéma ne sert à rien si le mapper ne la peuple pas. Les deux
   chantiers sont ordonnés, pas fusionnés.
3. **Ne pas sur-concevoir.** Le pavage de tiles se gère à plat (pas de nouveau primitif). Le
   masque par forme se gère via SVG `<clipPath>`/`<mask>` standard, pas une mécanique custom.
4. **Impact aval maîtrisé.** Orion `emit_lsml.go` spread les props opaques (`emit_lsml.go:99-107`)
   et porte `lsml` comme string libre (`emit_lsml.go:17`) → un bump 1.1→1.2 traverse Orion sans
   changement Go tant que les nouvelles props restent des clés top-level/children. Le coût réel
   est runtime Solar + compiler TS + validation.
5. **Anti-drop et sécurité d'ADR 001 restent invariants.** Toute prop ajoutée passe l'allowlist
   (sinon warn), tout ce qui atterrit en CSS/SVG inline passe le parser strict (RC#11), tout
   `d`/transform reste borné/linéaire (RC#10/#12).

## 3. Decision

**GO**, en 3 phases ordonnées. Phase D1 (positionnement absolu) débloque immédiatement le carré
rating et toute composition libre — **prioritaire, indépendante de la spec**. Phases D2/D3
livrent LSML 1.2 (effets/masques/image-fills) pour la cible 0-perte cover.

### 3.1 D1 — Positionnement absolu rendu (lacune de layout, AUCUN changement de spec)

Le champ `position:{x,y}` existe déjà en 1.1. On l'**honore au rendu** :

- Ajouter `position` (et son corollaire de placement) à l'allowlist de **tout** primitif feuille
  et conteneur (`prop-allowlist.ts`) — au minimum `text`, `shape`, `frame`, `stack`, `grid`,
  `media`, `image` (déjà), `instance` (déjà).
- `Tree` extrait `position` dans le bloc universel (`tree.tsx:97-103`) ; `UniversalWrapper`
  applique un placement absolu **quand le parent l'autorise**.
- **Modèle de placement** : un enfant porteur de `position` est rendu en
  `position:absolute; left:x; top:y` **relativement au conteneur positionné le plus proche**.
  `Frame` (déjà `position:absolute`) et `Stack`/`Grid` deviennent `position:relative` quand ils
  ont au moins un enfant absolu, pour établir le bloc conteneur. Un enfant **sans** `position`
  garde le flux normal (auto-layout intact). Cette dualité « flux + absolu » reflète exactement
  Figma (auto-layout vs free-form, et `layoutPositioning:"ABSOLUTE"` déjà capturé
  `figma-extras.ts:332-333`).
- `width`/`height` deviennent applicables à un `text`/`shape` absolu (le carré rating fixe ses
  boîtes 24×7 et 14×22). À défaut, `hug` sur le contenu.

> Pas de bump de version : 1.1 décrivait déjà `position`. C'est un **remboursement de dette
> d'implémentation runtime**, dans la lignée d'ADR 001 §3.2 (D2).

### 3.2 D2 — LSML 1.2 : effets statiques, blend modes, masques, image-fills (langage core)

Promotion en **core rendable** des familles aujourd'hui mortes en `metadata.figma.*`. Toutes ces
constructions sont **obligatoires en 1.2** (plus optionnelles) : chacune est requise pour le
0-perte strict de `817:3`, prouvée nœud par nœud (§1.2). Nouvelles constructions de schéma
(additives, 1.1→1.2) :

- **`blendMode`** _(obligatoire)_ sur tout primitif (→ `mix-blend-mode` CSS, enum fermé fidèle à
  Figma moins `PASS_THROUGH`). Allowlist d'enum, jamais passthrough. **Preuve** :
  `mix-blend-hard-light` sur `817:84` (Ruby20) et `817:1994` (wavy shape) — 0 support 1.1.
- **`mask`** _(obligatoire)_ : masque par forme **ou image**. Modèle de schéma :
  `mask:{ source: <ref forme | image src>; type:"alpha"|"luminance"; op:"intersect"|"subtract"|"union";
position?; size? }`. Un nœud `isMask:true` (déjà capturé `figma-extras.ts:225`) devient, au rendu,
  un `<mask>`/`<clipPath>` SVG appliqué à ses siblings suivants dans le groupe (sémantique Figma).
  **Preuve** : `Mask group 817:1991` = masque **alpha**, op **intersect**, par image d'ellipse,
  avec position/size — 0 support 1.1 (`clipsContent` ne fait qu'un clip rect au `size`).
  **Remplace** `clipsContent` pour les cas non-rect.
- **Image-fill sur shape ET frame** _(obligatoire)_ comme **fill de première classe** :
  `LSMLFill | { kind:"image"; src; objectFit:"cover"|"contain"|"fill"; opacity?; transform? }`.
  Unifie l'image-fill frame (aujourd'hui `metadata.figma.imageBackgrounds`) et débloque l'image-fill
  shape (aujourd'hui droppée `shape.ts:65`). Le primitif `image` reste pour l'image-en-tant-que-nœud.
  **Preuve** : `817:84`, `817:1174`, `817:1992/1994` = images **dans des formes** (`object-cover`).
- **Gradient transform** _(obligatoire)_ : `LSMLFill` gradient porte une matrice 2×3 (au-delà de
  `angle_deg`), rendue via `gradientTransform` SVG. Récupère la matrice déjà stashée. **Preuve** :
  `WP Gradient` réduit aujourd'hui à `angle_deg` (`color.ts:124`).
- **`effects[]`** sur tout primitif : `drop-shadow`/`inner-shadow` (→ SVG `filter`/`feDropShadow`
  ou `box-shadow` CSS selon primitif), `blur` (→ `filter: blur()`). Valeurs (couleur, offset,
  radius, spread) parser strict RC#11. _(Non requis par `817:3` mais dans le périmètre 1.2.)_
- **Angular/diamond gradient** : `kind:"angular-gradient"|"diamond-gradient"` (déjà anticipés
  `fill.tsx:209-227` comme « land with LSML 1.2 »). Rendu SVG/`conic-gradient`.

> **Pas de `noise/texture/glass` procédural à spécifier.** Les faits `817:3` (§1.2) prouvent que
> ces apparences = blend + masque + image-fill + gradient (ci-dessus), et que la « texture » est
> **190 `<img>`** structurelles (§3.5). Il n'y a donc **aucun** effet procédural résiduel à rendre
> et **aucun fallback raster** : le 0-perte est atteint par les constructions natives ci-dessus.

### 3.3 D3 — Réconciliation transcription (mapper) avec 1.2

Une fois 1.2 rendable, le mapper **peuple les champs core** au lieu de (ou en plus de) stasher
en metadata :

- `mapping/shape.ts` : porter les paints IMAGE en `fills[{kind:"image"}]` (fin du drop
  `shape.ts:65`).
- `mapping/frame.ts` : émettre `backgrounds[{kind:"image"}]` au lieu de
  `metadata.figma.imageBackgrounds`.
- `figma-extras.ts` : émettre `effects[]`/`blendMode`/`mask` core (le `metadata.figma.*` reste
  pour les champs **non promus** : noise/texture/glass, smoothing, layout grids/guides — round-trip
  Figma-only, légitimement ignorés au runtime).
- `color.ts` : émettre la matrice gradient core ; cesser de dégrader en `angle_deg` seul quand
  la matrice est non-triviale.

### 3.4 Politique anti-drop & sécurité (invariant ADR 001)

- Toute prop 1.2 ajoutée → entrée d'allowlist + test anti-drop (ADR 001 §3.4 / RC#7).
- Tout `effects`/`blendMode`/fill-image/`transform` rendu en CSS/SVG inline → parser strict +
  bornes linéaires (RC#10/#11/#12). `src` d'image-fill → même allowlist d'hôtes que `image`
  (`bundle.assets.allowedHosts`). `<clipPath>`/`<mask>` : pas d'injection (réfs d'id internes).
- **Clearance Bastion CONDITIONNELLE (threat-model design livré, 2026-06-17).** Pas de veto au
  design ; le merge de tout code D2/D3 reste gated — **Bastion re-valide chaque PR** contre les
  6 conditions ci-dessous. Non tenue = VETO (levé par fix ou acceptation de risque écrite ici).
  Détail d'ancrage verbatim : `D:\Documents\.audit-lsml\bastion-conditions-1.2.md`.
  1. **T1 — allowlist d'hôtes enforced runtime ET compiler** (double-gate : les deltas LSDP live
     bypassent le compiler). Tout `src` image-fill / `mask.source`-image passe par
     `isHostAllowed(url, bundle.assets.allowedHosts)` (match strict `new URL().hostname`, jamais
     substring) AVANT le DOM ; rejet → diagnostic + omission, jamais passthrough. Ferme aussi le
     **trou latent 1.1**. Module partagé `host-allow.ts` + `image/fill/mask.tsx` + `compile.ts`.
     → #F (fondation), #E, #C.
  2. **T2 — allowlist de schémas d'URL** : `https:` only (+ `data:image/*` borné si justifié) ;
     `javascript:`/`data:text|html`/`file:`/`blob:`/`vbscript:` rejetés sur `<img src>`,
     `mask-image`, `background-image`. Runtime + compiler + `schema.json`. → #F, #E, #C.
  3. **T3 — zéro markup SVG arbitraire du bundle.** `<mask>`/`<clipPath>` construits par builder
     typé runtime depuis des champs typés (source/type/op/position/size). **Interdit dur** de
     `dangerouslySetInnerHTML`/`innerHTML` sur tout contenu bundle → foreignObject/script/
     event-handler structurellement impossibles. → #E, #I.
  4. **T4 — parser strict + enums fermés** sur `blendMode`/`mask.type`/`mask.op`/`objectFit`
     (hors-liste = diagnostic + omission, jamais passthrough) ; `gradientTransform` = 6 floats
     finis bornés, jamais string libre interpolée. Réutiliser `css-color.ts`/`filter-clamp.ts`.
     Double-gate compiler+runtime. → #D, #E, #F, #I.
  5. **T5 — bornes anti-DoS testées sous payload pathologique** : blur réutilise le cap existant
     (`MAX_FILTER_BLUR_PX=100`, **ne pas ré-ouvrir**) ; budget de complexité par bundle (nœuds
     blend, profondeur masques, nb image) mesuré en CI + refusé à l'authoring ; dimensions/timeout
     de fetch d'asset bornés ; pas de freeze CEF live. Profilage `817:3` avant go-live. → #I, #J.
  6. **T6 — gate de validation d'authoring** refuse src hors-allowlist / enum hors-liste / budget
     dépassé **AVANT l'antenne** (sûreté au gate, doctrine porteur). `emit_lsml.go` (Orion)
     **PRÉSERVE** `assets.allowedHosts` (spread opaque, ne le strippe ni ne le fabrique). Runtime
     = défense en profondeur, jamais barrière unique. → #I (primaire), #G, #H.
- **T7 — recommandation FERME non bloquante (portée Keeper, hors `lumencast-js`).** CSP au host
  CEF (Pulsar/Solar) : `default-src 'none'`, `img-src` = allowlist, `style-src` restreint,
  `script-src 'self'`. Défense en profondeur indépendante du bundle ; non bloquant pour D2/D3 si
  T1–T6 tenus. À porter par Keeper (runbook/ADR infra).

### 3.5 Phasage, versioning, non-décisions

- **Ordre** : D1 (runtime pur, débloque le live tout de suite) → RFC 1.2 figé sur
  `lumencast-protocol` → D2 (schéma + runtime + compiler) → D3 (mapper). D1 ne dépend de rien.
- **Versioning** : D1 = 1.1 (dette). D2/D3 = **LSML 1.2** (additif, rétro-compatible : un bundle
  1.1 reste valide ; `LSMLBundle.lsml` accepte `"1.2"`). `emit_lsml.go:17` bump string `"1.2"`,
  aucune autre modif Go (props opaques).
- **Non-décision pavage (lossless, optimisation hors-scope)** : les ~190 tiles de `817:2017`
  restent **à plat, en structure** — chacune un nœud `image` qui round-trip → **0-perte**.
  `repeat` est data-driven, inadapté à un pavage figé ; un primitif « tile » de pavage serait une
  **optimisation** (compression du bundle), **pas une condition de 0-perte** → explicitement
  **hors-scope** de cet ADR, noté pour un futur RFC perf. Coût bundle surveillé par le budget gz
  d'ADR 001 RC#8.
- **Noise/texture/glass — résolu (R5), 0-perte EN-LANGAGE.** Tranché porteur (2026-06-17) et
  confirmé par les faits `817:3` (§1.2) : ces apparences ne sont **pas** procédurales. Elles se
  décomposent intégralement en `blendMode` + `mask` + image-fill + gradient (§3.2, tous
  **obligatoires**) + le pavage d'images ci-dessus. Donc :
  - **Fallback raster — ALTERNATIVE CONSIDÉRÉE ET REJETÉE.** Aplatir un nœud en image-fill
    bitmap supprime l'éditabilité et l'intention paramétrique (couleur de marque, masque
    réutilisable, recadrage `object-fit`, gradient transform) = **une perte d'information** →
    viole l'exigence « 0 information ». Rejetée.
  - **Acceptation de risque (rendu approximé/ignoré) — REJETÉE.** Un écart visuel toléré est par
    définition un écart → viole « 0 écart ». Rejetée.
  - **Retenu** : expression native via les constructions 1.2 obligatoires. **Aucun nœud
    rastérisé/aplati** n'est admis sur la cible de conformance `817:3` (RC#10).

## 4. Consequences

- **Le carré rating et toute composition free-form se rendent fidèlement dès D1** — sans toucher
  la spec ni Orion. Gain le plus rapide et le plus large.
- LSML passe 1.1→1.2 ; SDK impactés : `@lumencast/runtime` (Solar), `@lumencast/compiler`,
  `lumencast-figma` (mapper), `lumencast-protocol` (spec), `lumencast-go` (string version + tests
  de round-trip bytes), `lumencast-py`/`-rs` (validateurs, si présents — à inventorier au RFC).
- `metadata.figma.*` cesse d'être « travail mort » pour les familles promues ; reste le canal
  round-trip Figma pour le non-rendable (légitime).
- Coût Solar non trivial : `filter`/`mix-blend-mode`/`mask` peuvent toucher le hot path de
  perf (budget delta→DOM p95 ≤ 50 ms d'ADR 001 RC#8). Ces props sont **statiques** (pas animées),
  donc hors hot path par construction — à garder invariant (cf. `frame.tsx:9-12`).

## 5. Risks

- **R1 — Perf rendu (D2).** `filter`/`mask`/`mix-blend-mode` imbriqués sur 190 tiles + grandes
  ellipses de la cover peuvent dégrader le framerate CEF. _Mitigation_ : props statiques hors hot
  path ; budget de complexité (nb d'effets/masques par bundle) mesuré en CI ; profilage sur
  `817:3` avant go-live. **À threat-modéliser avec Bastion** (DoS rendu).
- **R2 — Surface d'injection (D2).** Image `src` en fill, `<mask>`/`<clipPath>` id refs, valeurs
  d'effet en CSS → nouveaux sites. _Mitigation_ : parser strict RC#11, allowlist d'hôtes, bornes
  RC#10/#12. **Clearance Bastion bloquante.**
- **R3 — Dérive multi-SDK.** Un bump 1.2 mal coordonné casse le round-trip bytes `lumencast-go`.
  _Mitigation_ : RFC figé d'abord, validateurs alignés avant tout merge runtime ; fixtures golden
  cross-SDK.
- **R4 — Modèle de placement D1.** Mal posé (`relative`/`absolute`), il casse l'auto-layout
  existant des scènes en prod (boards live actuels). _Mitigation_ : enfant sans `position` =
  flux normal strictement inchangé ; suite de non-régression sur les bundles live actuels
  (GIDEON…Namgung, canary R9) avant merge D1.
- **R5 — Noise/texture/glass — RÉSOLU (2026-06-17), plus un risque ouvert.** Le pull
  `get_design_context` réel de `817:3` (§1.2) prouve que ces apparences = blend modes + masques
  alpha image/forme + image-fills + gradient + pavage de 190 `<img>` — **pas** d'effet procédural.
  Toutes ces familles sont des features core 1.2 **obligatoires** (§3.2). Le 0-perte strict est
  donc atteint **EN-LANGAGE**, sans raster ni acceptation de risque (les deux écartés, §3.5).
  Aucune mitigation résiduelle requise ; la conformance est vérifiée par RC#10 (diff pixel nul,
  0 nœud rastérisé). _Risque résiduel reporté sur R1 (perf des effets/masques réels)._

## 6. Resolution criteria

Testables ; CI `lumencast-js` sauf mention.

1. **D1 — carré rating fidèle.** Une fixture `frame` non-auto-layout avec 2 enfants `text`
   `position:{x,y}` distincts rend les deux `<span>` à des `left/top` calculés égaux à
   `x`/`y` (DOM smoke happy-dom) ; le fond `background` du frame est présent. Le bundle réel
   du Rating_Block (`49:721`) rendu = textes à (13,8) et (18,19), non superposés.
2. **D1 — non-régression auto-layout.** Les bundles live actuels (au moins un board de prod +
   le canary R9) rendent **à l'identique** avant/après D1 (snapshot DOM stable) : un enfant
   sans `position` n'est jamais déplacé.
3. **D1 — allowlist.** `position`/`width`/`height` sont consommés (pas de diagnostic anti-drop)
   sur `text`/`shape`/`frame`/`stack`/`grid` ; un `position` mal typé (non-`{x,y}` numérique)
   → diagnostic R9, pas de CSS inline (RC#11).
4. **D2 — effets.** `effects:[{kind:"drop-shadow",...}]` et `{kind:"blur",radius}` produisent
   le `filter`/`box-shadow` attendu (DOM smoke) ; couleur d'ombre passe le parser strict ;
   valeur hostile (`url(`, `;`) rejetée.
5. **D2 — blend.** `blendMode:"MULTIPLY"` → `mix-blend-mode: multiply` ; enum hors liste →
   diagnostic + omission.
6. **D2 — masque.** Un nœud `isMask` + sibling masqué → `<clipPath>`/`<mask>` SVG produisant le
   clip par forme (le `Mask group 817:1991` round-trip rendu, diff visuel attendu).
7. **D2 — image-fill.** Un `shape` et un `frame` avec `fills/backgrounds:[{kind:"image",src}]`
   rendent l'image (src hors `allowedHosts` rejeté) ; le rounded-rect « Ruby20 » de la cover
   affiche sa texture.
8. **D2 — gradient transform + angular/diamond.** Un gradient avec matrice non-triviale rend via
   `gradientTransform` SVG ; `angular-gradient`/`diamond-gradient` ne sont plus droppés
   (`fill.tsx:214-227`).
9. **D3 — mapper.** `mapShape` n'écarte plus les paints IMAGE (`shape.ts:65`) ; `mapFrame` émet
   `backgrounds[image]` ; `figma-extras` émet `effects/blendMode/mask` core. Round-trip plugin :
   `817:3` exporté → 0 famille promue restée en `metadata.figma.*`.
10. **Round-trip 0-perte STRICT (cible `817:3`).** `817:3` Figma→LSML→render comparé au screenshot
    Figma de référence : **diff pixel nul** (SSIM = 1.0 / aucune zone exclue — pas de « hors zones
    noise/texture » : il n'y a plus de zone non rendable, cf. §3.2). **Invariant dur : AUCUN nœud
    de `817:3` n'est rastérisé ni aplati** (le harness échoue si un nœud promu — blend/mask/
    image-fill/gradient — est servi en bitmap pré-rendu au lieu de sa construction 1.2). Les ~190
    tuiles `817:2017` restent en structure (nœuds `image`, lossless). `49:721` round-trip rendu
    idem. Mesure offline (headless render → image), pas un screenshot CEF (cf. règle live-testing).
11. **Versioning.** Un bundle `lsml:"1.2"` valide round-trip bytes-stable à travers
    `lumencast-go` (`emit_lsml.go` + fixtures) ; un bundle `1.1` reste valide (rétro-compat).
12. **Sécurité (Bastion).** Threat model écrit sur `filter`/`mix-blend-mode`/`mask`/image-fill ;
    parsers strict + linéaires (RC#11/#12) sur toute nouvelle valeur CSS/SVG ; budget de
    complexité d'effets/masques borné et testé sous payload pathologique (pas de freeze rendu).
13. **Perf.** Budget delta→DOM p95 ≤ 50 ms et 0 layout event sur le hot path **tenus** avec
    effets/masques présents (statiques) — fixture cover jouée en E2E.
14. **RFC.** `[RFC] LSML 1.2` (issu d'ADR 001 RC#9) figé sur `lumencast-protocol` couvrant les
    features **obligatoires** `blendMode`, `mask` (source forme|image, type alpha|luminance, op
    intersect|subtract|union, position/size), image-fill première classe (+ `objectFit`), gradient
    transform, plus `effects[]` et angular/diamond, et l'inventaire des SDK impactés.
    **Pas de décision noise/texture/glass à prendre** : tranchée ici (0-perte en-langage, raster et
    acceptation de risque écartés, §3.5). Le RFC fige les schémas, pas l'arbitrage.

## 7. Découpage en issues (prêt pour `/build`)

> Ordre = dépendances. D1 part immédiatement ; D2/D3 après RFC figé.

- **#A (D1, runtime)** — Honorer `position`/`width`/`height` absolus au rendu : allowlist
  (`prop-allowlist.ts`), extraction `Tree` (`tree.tsx:97-103`), placement absolu
  `UniversalWrapper` + `position:relative` conditionnel sur `Frame`/`Stack`/`Grid`. RC#1, #2, #3.
- **#B (D1, validation)** — Fixture Rating_Block `49:721` + non-régression bundles live + canary.
  RC#1, #2.

  > **Conditions Bastion gravées en critères d'acceptation (T1–T6, cf. §3.4).** Chaque condition
  > ci-dessous est un critère **« doit passer »** avec son test associé ; Bastion re-valide chaque
  > PR. Mapping : T1→#F/#E/#C · T2→#F/#E/#C · T3→#E/#I · T4→#D/#E/#F/#I · T5→#I/#J · T6→#I/#G/#H.

- **#C (RFC + schéma 1.2, FONDATION)** — Figer `[RFC] LSML 1.2` sur `lumencast-protocol` : schémas
  des features **obligatoires** (blend/mask/image-fill/gradient-transform) + effects/angular-diamond
  - SDK + diff pixel nul `817:3`. **Module `host-allow.ts` + enums fermés** posés ici (fondation
    partagée runtime/compiler). **Pas d'arbitrage noise/texture/glass** (tranché ADR §3.5). RC#14.
  * **T1/T2 (schéma)** : `schema.json` borne `src`/`mask.source` au pattern `https:`(+`data:image/*`)
    et déclare `assets.allowedHosts` ; un schéma `lsml:"1.2"` sans allowlist effective ne valide pas.
  * **Acceptance** : module `host-allow.ts` (`isHostAllowed`, match strict `new URL().hostname`)
    exporté + testé (allow exact, reject sous-domaine non listé, reject substring-spoof) avant tout
    consommateur.
- **#D (D2, schéma+runtime)** — `blendMode` core **(obligatoire, `817:84`/`817:1994`)** +
  `effects[]` : types (`lsml-types.ts`/`schema.json`), rendu (`primitives/*`, `fill.tsx`), parser
  strict, allowlist. RC#4, #5.
  - **T4 (doit passer)** : `blendMode` hors enum fermé → diagnostic + omission, **jamais**
    passthrough ; couleur/offset d'`effects` passe `css-color.ts`/`filter-clamp.ts` (pas de string
    libre interpolée) ; double-gate compiler+runtime testé.
- **#E (D2, runtime)** — `mask` par forme **ou image**, type alpha|luminance, op
  intersect|subtract|union, position/size **(obligatoire, `Mask group 817:1991`)** : SVG
  `<mask>`/`<clipPath>` ; remplace `clipsContent` non-rect. RC#6.
  - **T3 (doit passer)** : `<mask>`/`<clipPath>` construits par **builder typé** ; un `mask`
    injectant `<script>`/`foreignObject`/event-handler ne produit **aucun élément exécutable**
    (assertion DOM) ; `dangerouslySetInnerHTML`/`innerHTML` absent du chemin mask (test statique).
  - **T1/T2 (doit passer)** : `mask.source`-image rejetée si hôte hors `allowedHosts` ou schéma ≠
    `https:`/`data:image/*` (`src: javascript:` rejeté, aucun fetch émis).
  - **T4 (doit passer)** : `mask.type`/`mask.op` hors enum → diagnostic + omission.
- **#F (D2, schéma+runtime — host-allow ENFORCEMENT, PRIORITAIRE)** — Image-fill première classe
  (`{kind:"image"}` + `objectFit` dans `LSMLFill`) **(obligatoire, `817:84`/`817:1174`/`817:1992`)**
  - gradient transform **(WP Gradient)** + angular/diamond. RC#7, #8.
  * **T1 — enforcement runtime+compiler de l'allowlist d'hôtes (FONDATION, prioritaire).** Câbler
    `host-allow.ts` (#C) dans `image.tsx`/`fill.tsx` + `compile.ts` : tout `src` image-fill passe
    `isHostAllowed` AVANT le DOM ; rejet → diagnostic + omission. **Referme aussi le trou latent
    1.1** (allowlist déclarative jamais enforced, exploitable dès 1.1) — c'est pourquoi T1 part en
    premier dans le chantier. **Doit passer** : `src` hôte non listé → omis + diagnostic, jamais
    rendu ; delta LSDP live avec hôte pirate également bloqué (gate compiler ET runtime).
  * **T2 (doit passer)** : `src: javascript:`/`data:text/html`/`file:` rejetés (aucun `<img>`/fetch).
  * **T4 (doit passer)** : `objectFit` hors enum → omission ; `gradientTransform` = 6 floats finis
    bornés (rejet de NaN/Inf/string).
- **#G (D2, compiler)** — `@lumencast/compiler` forwarde les nouvelles props 1.2 ; `emit_lsml.go`
  bump `"1.2"` + fixtures round-trip `lumencast-go`. RC#11.
  - **T6 (doit passer)** : `emit_lsml.go` **préserve** `assets.allowedHosts` (fixture round-trip :
    `allowedHosts` présent en entrée ⇒ présent à l'identique en sortie, jamais strippé).
- **#H (D3, mapper)** — `lumencast-figma` peuple les champs core 1.2 (image-fill shape/frame,
  effects/blend/mask) ; arrêt des drops `shape.ts:65`, `color.ts` angle-only. RC#9.
  - **T6 (doit passer)** : le mapper émet `assets.allowedHosts` cohérent avec les `src` qu'il
    produit (pas de `src` dont l'hôte serait absent de l'allowlist émise).
- **#I (D2/D3, GATE DE VALIDATION D'AUTHORING + fixture sécu)** — Le threat-model est **livré**
  (§3.4) ; #I devient l'**implémentation du gate d'authoring (T6 primaire)** : refus `src`
  hors-allowlist / enum hors-liste / budget de complexité dépassé **AVANT l'antenne**, plus la
  **fixture sécu pathologique** partagée. Bastion re-valide. RC#12, #13.
  - **T6 (doit passer)** : un bundle authoring avec `src` hôte non listé / `blendMode` hors enum /
    budget dépassé est **refusé au gate** (pas seulement au runtime) — la sûreté est au gate.
  - **T5 (doit passer)** : budget de complexité (nœuds blend, profondeur masques, nb image) mesuré
    et refusé au-delà du cap ; fixture **pathologique** (masques profondément imbriqués, blur
    massif, N images) ne **freeze pas** le rendu et reste sous le cap blur existant (`=100`).
  - **T4/T3 (doit passer)** : la fixture sécu couvre enum hostile + payload `<script>`/`javascript:`
    et prouve omission/diagnostic sans exécution.
- **#J (validation 0-perte stricte + perf)** — Harness de diff pixel offline (cible `817:3`) ;
  round-trip `817:3` **diff pixel nul + assertion 0 nœud rastérisé/aplati** (tuiles `817:2017` en
  structure) ; `49:721` idem. RC#10.
  - **T5 (doit passer)** : profilage de la fixture `817:3` sous charge réelle d'effets/masques —
    pas de freeze, budget delta→DOM p95 ≤ 50 ms tenu (lien RC#13).

> **Ordre de dépendances pour `/build`.** **#C** (RFC + schéma 1.2 + module `host-allow` + enums
> fermés = fondation) part **en premier** et débloque tout le reste. Puis, par dépendance de
> fondation : **#F** câble l'enforcement T1 host-allow (runtime+compiler) — **prioritaire car
> c'est la fondation sécu et il referme le trou latent 1.1**. **#D**/**#E** (blend/effects, mask)
> consomment `host-allow.ts` et les enums de #C → **parallélisables entre eux** une fois #C mergé,
> et avec #F (modules runtime distincts : `primitives/fill` vs `mask` vs `image`). **#G**
> (compiler forward + `emit_lsml.go` bump 1.2, **préserver `allowedHosts`**) après que les schémas
> #C/#D/#E/#F sont figés. **#H** (mapper) après #G (consomme le schéma compilé). **#I** (gate
> d'authoring + fixture sécu) après #D/#E/#F (a besoin des enums/host-allow réels à gater) —
> **bloquant avant tout merge D2/D3**. **#J** (diff-pixel `817:3` + profilage) en dernier, après
> #H et #I (a besoin du pipeline mapper→runtime complet et de la fixture pathologique de #I).
> Chemin critique : **#C → #F → #I → #J**. Parallèle utile : #D ∥ #E (après #C), #B (D1) sur sa
> propre voie indépendante.
