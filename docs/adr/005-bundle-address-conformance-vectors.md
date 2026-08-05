# ADR 005 — L'adresse d'un bundle est définie par des vecteurs, pas par une implémentation

- **Status**: accepted
- **Date**: 2026-08-05
- **Decided**: 2026-08-05
- **Deciders**: @ClodoCapeo
- **Author**: Atlas
- **Supersedes**: —
- **Superseded by**: —

> Réfère, ne contredit pas : **LSML 1.0 §3** (`spec/LSML-1.md` — JCS/RFC 8785, plus
> la divergence nommée du placeholder `scene_version`), **ADR 002 §3.4 / A5.5**
> (corpus partagé hébergé par `lumencast-protocol` — même motif, même domicile),
> **ZabCanvas ADR 007 §A** (refus d'un troisième canonicaliseur — §1.3 explique
> pourquoi ce refus regardait la mauvaise direction), **ZabCanvas ADR 010 §3.1**
> (le `content_hash` d'authoring est un identifiant interne délibérément non-JCS —
> **à ne pas confondre avec l'adresse d'un bundle**, cf. §3.6).
>
> Origine : incident des 19 bundles dont Orion abandonne les `defaults`, mécanisme
> identifié par Bastion.

## 1. Context

### 1.1 L'incident

Orion re-vérifie l'adresse d'un bundle qu'il vient de récupérer avant d'en injecter
les `defaults` (`bundleMatchesAddress`, `Orion/internal/compiler/http_fetcher.go:217-228`).
Sur 19 bundles **légitimes**, la vérification échoue et les `defaults` sont
abandonnés : la scène rend, mais nue. Taux de faux positifs mesuré à **9 %** sur
cette classe (#299).

Ce n'est pas un incident de sécurité — le garde _retire_ du contenu, il n'en ajoute
pas, et c'est la dissymétrie voulue (`http_fetcher.go:213-216` : « this guard removes
injected content from the antenna, it must not remove the antenna »). C'est un
incident de **contrat** : deux implémentations d'une même spec ne calculent pas la
même adresse pour le même bundle.

### 1.2 Le mécanisme, vérifié

- `packages/compiler/src/canonicalize.ts:31-46` — `stringify` renvoie `"null"` pour
  une valeur `undefined`, **et la clé est conservée** : `Object.keys()` la renvoie,
  la boucle l'émet. `{a: undefined}` se canonicalise donc en `{"a":null}`.
- `JSON.stringify({a: undefined})` produit `{}` — la clé **ne voyage pas**.
- Le producteur TS hache par conséquent **une forme qui n'est jamais envoyée**. Le
  consommateur Go hache les octets **tels que reçus** (`lsml.HashRaw`,
  `http_fetcher.go:206-219`). Chacun est correct sur ce qu'il hache ; ils ne hachent
  pas le même document.
- Le commentaire de la ligne fautive dit `undefined … drop` pendant que le code émet
  `"null"`. **Le commentaire et le code se contredisent depuis l'origine** — c'est ce
  qui a laissé passer la revue : un relecteur lit l'intention, pas la branche.

### 1.3 Le fait qui change le cadrage : il y a déjà trois canonicaliseurs, dont deux dans le même dépôt

`packages/protocol/src/conformance/bundle-hash.ts:1-3` porte, en clair :

> « Duplicated from `@lumencast/compiler` to avoid a circular workspace dep
> (compiler depends on protocol). **Keep the two in sync.** »

Et la copie porte **le même bug, ligne pour ligne** (`:25-36`). Deux conséquences,
et la seconde est la plus grave :

1. Le point de synchronisation entre deux implémentations d'un hachage
   content-addressed est **une phrase dans un commentaire**.
2. Cette copie est celle du **harnais de conformance**. L'outil censé détecter la
   dérive porte la dérive : **une conformance construite dessus aurait béni le
   défaut**.

ZabCanvas ADR 007 §A a refusé un troisième canonicaliseur — en Python — au motif
exact du risque de dérive. Ce refus était juste, et il regardait la mauvaise
direction : la troisième implémentation existait déjà, dans le monorepo, tenue par
un commentaire.

### 1.4 Ce que dit la spec — et pourquoi ça n'a rien empêché

`spec/LSML-1.md` §3.1 impose **JCS (RFC 8785)**, avec une seule divergence nommée
(§3.2, le placeholder `scene_version`). JSON n'a pas d'`undefined` : un membre absent
n'est pas un membre à `null`. **Le canonicaliseur TS est donc en faute contre la
spec, pas contre une opinion** — et son correctif est un bug, pas une décision
d'architecture (routé séparément, cf. §3.6).

Le point qui motive ce texte est ailleurs : **la spec disait déjà tout cela avant
l'incident, et n'a rien empêché**. Une spec qu'aucun artefact exécutable n'oppose aux
implémentations est une intention. Six semaines de production et un audit ont été
nécessaires pour découvrir une divergence qu'un fichier de vecteurs aurait signalée
au premier `pnpm test`.

## 2. Decision drivers

1. **Une spec sans vecteurs ne contraint personne.** C'est le constat de §1.4, pas une
   position de principe.
2. **Le point de synchronisation ne peut être ni un commentaire, ni une revue
   humaine** — les deux ont échoué ici, à l'endroit précis où ils étaient censés
   tenir.
3. **L'oracle ne doit être aucune des implémentations** : choisir l'une d'elles fige
   son bug en contrat.
4. **Langage-agnostique**, parce qu'une implémentation future n'aura accès ni au code
   TS ni au code Go. C'est déjà la doctrine affichée de `conformance/README.md`.
5. **Ne pas créer un quatrième canonicaliseur** pour tester les trois autres — ce
   serait reproduire la cause en croyant la traiter.

## 3. Decision

### 3.1 L'adresse est définie par un jeu de vecteurs, hébergé par le protocole

Un nouveau domaine de conformance, `conformance/v1/fixtures/bundle-address/` dans
**`lumencast-protocol`** — même domicile et même motif que le corpus d'entrées d'hôte
d'ADR 002 A5.5 : le seul des dépôts concernés qui n'est ni producteur ni consommateur
du calcul.

Un vecteur porte **quatre** informations, et chacune ferme une ambiguïté :

```json
{
  "name": "placeholder-substituted",
  "note": "un scene_version déjà rempli d'une valeur erronée donne la même adresse qu'un placeholder",
  "input": {
    "lsml": "1.0",
    "scene_id": "s",
    "scene_version": "sha256:deadbeef…",
    "layout": { "kind": "stack" }
  },
  "substitute_scene_version": true,
  "canonical": "{\"layout\":{\"kind\":\"stack\"},\"lsml\":\"1.0\",\"scene_id\":\"s\",\"scene_version\":\"sha256:000…000\"}",
  "expected": "sha256:<64 hex>"
}
```

- **`input`** est le document **tel qu'il voyage**, `scene_version` compris et écrit en
  clair. Le champ ne peut pas être laissé implicite : c'est le seul du bundle dont la
  valeur d'entrée n'est pas celle qui est hachée.
- **`substitute_scene_version`** dit **explicitement** si la substitution de spec §3.2
  (placeholder à 64 zéros) s'applique avant hachage. Sans ce booléen, deux
  implémentations peuvent produire deux adresses différentes **en ayant toutes deux
  raison** — l'une ayant lu « on hache le document », l'autre « on hache le document
  substitué ». C'est exactement le genre d'ambiguïté qui a produit l'incident.
- **`canonical`** est la **forme canonique attendue, en octets**. Elle n'est pas
  redondante avec `expected` : deux implémentations peuvent tomber sur la même adresse
  par des chemins différents, et surtout, quand elles divergent, `canonical` **localise
  la faute** au lieu de dire seulement qu'elle existe. Les goldens inter-SDK existants
  portent déjà cette information (`lumencast-py/tests/unit/test_lsml_hash_xlang.py`) —
  c'est un motif éprouvé, pas une invention.
- **`expected`** est l'adresse.

**Le vecteur porte le document, jamais l'objet en mémoire.** Un vecteur est du JSON sur
disque : il **ne peut pas** contenir d'`undefined`. Cette propriété est ce qui rend le
contrat clair — et c'est aussi, exactement, ce qui l'empêche de voir le défaut de cet
incident. §3.1 bis en tire la conséquence au lieu de la masquer.

### 3.1 bis Les vecteurs ne peuvent pas voir ce défaut-là — d'où une seconde propriété, côté producteur

Le défaut de §1.2 ne vit pas **dans** un document : il vit dans **l'écart entre l'objet
haché et les octets envoyés**. Or une arme de conformance charge un vecteur par
`JSON.parse` : aucun `undefined` ne peut y apparaître, donc le canonicaliseur fautif
produit exactement la même sortie que le correct. **Un corpus de vecteurs est vert avant
le correctif comme après.** Le dire ici plutôt que de le découvrir à l'implémentation
est le seul moyen que ce texte ne promette pas ce qu'il ne tient pas.

**Décision : un second artefact, de nature différente — une propriété testée en code,
chez le producteur.**

> **Une implémentation doit hacher ce qu'elle sérialise.**
> Pour toute valeur `x` que le producteur accepte de hacher :
> `hash(x) == hash(JSON.parse(JSON.stringify(x)))`.

Elle **échoue aujourd'hui** (`{a: undefined}` hache `{"a":null}` d'un côté, `{}` de
l'autre) et **passe après correctif**, sans oracle externe, sans fixture, sans
comparaison inter-langage. Elle attrape par ailleurs toute la classe — fonctions,
symboles, valeurs à `toJSON` — et pas seulement le cas connu.

Les deux artefacts ne se remplacent pas et ne se recouvrent pas :

| Artefact             | Ce qu'il définit                                                        | Ce qu'il ne peut pas voir                                                   |
| -------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Vecteurs (§3.1)      | **quelle adresse** a un document donné — l'oracle inter-implémentations | l'écart entre l'objet et sa sérialisation, qui n'existe pas dans un fichier |
| Propriété (§3.1 bis) | **ce que l'implémentation a le droit de hacher**                        | rien sur la valeur de l'adresse — elle n'a aucun oracle                     |

Chaque implémentation qui construit ses bundles en mémoire (le TS aujourd'hui, toute
future) porte cette propriété dans sa propre suite. Le Go, qui hache des octets reçus
(`lsml.HashRaw`), la satisfait par construction — et c'est précisément pourquoi il
n'avait pas le bug.

### 3.2 L'oracle n'est aucune des implémentations

`expected` ne peut pas être produit par le TS (cela figerait son bug) ni par le Go
(cela figerait les siens, connus ou non). Décision :

- `expected` est calculé par une **bibliothèque RFC 8785 tierce et éprouvée**, via un
  script de génération dans `lumencast-protocol/scripts/`. Cette bibliothèque n'est
  pas un quatrième canonicaliseur maison : c'est une dépendance externe dont le rôle
  s'arrête à produire un fichier, hors de tout chemin de production ;
- les **premiers vecteurs sont vérifiés à la main**, octet par octet, contre le texte
  de la RFC. Un générateur non relu déplace la confiance, il ne la crée pas ;
- **repli assumé** si aucune bibliothèque ne convient : `expected` figé à la main pour
  un corpus d'une vingtaine de vecteurs. Un vecteur est court ; c'est faisable, et
  c'est **plus sûr** qu'un générateur maison — qui serait, lui, exactement le
  quatrième canonicaliseur que le driver 5 interdit.

### 3.3 Le corpus minimal — nommé par les pièges, pas par les cas nominaux

Un corpus rempli de cas nominaux donne une conformance verte et vide. Chaque vecteur
existe pour un piège nommé :

| Piège                                                                  | Ce qu'il attrape                                                                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| membre **absent** vs membre à **`null`**                               | le défaut de cet incident — deux vecteurs distincts, deux adresses distinctes                                                            |
| ordre des clés (insertion ≠ tri)                                       | un canonicaliseur qui oublie de trier à un niveau imbriqué                                                                               |
| Unicode : échappements, paires de substitution, caractères de contrôle | JCS §3.2.2.2 — le point où les implémentations divergent le plus souvent                                                                 |
| nombres : entiers, `-0`, exposants, grands entiers                     | JCS §3.2.2.3 (`Number::toString` d'ECMAScript)                                                                                           |
| objets et tableaux **vides** imbriqués                                 | les raccourcis « omettre si vide »                                                                                                       |
| placeholder `scene_version`                                            | spec §3.2 : un bundle dont le champ porte déjà une valeur **erronée** doit produire la **même** adresse qu'un bundle au placeholder      |
| membre inconnu / d'extension (`animations`, `x-zab.*`)                 | il **compte** dans l'adresse — c'est précisément pourquoi Orion hache les octets reçus et non un modèle typé (`http_fetcher.go:206-213`) |

### 3.4 Chaque implémentation exécute les vecteurs dans sa propre CI

- **TS (`lumencast-js`)** — le harnais existe (`packages/protocol/src/conformance/`)
  et le job `conformance` fait déjà le checkout du dépôt protocole. C'est une famille
  de fixtures de plus, pas un mécanisme de plus.
- **Go (`lumencast-go`, consommé par Orion)** — arme Go, mêmes vecteurs, mêmes octets.
- **Toute implémentation future** — c'est l'objet même de `conformance/README.md`,
  qui promet déjà cette propriété sans l'avoir encore appliquée à l'adressage.

**Règles de consommation : celles d'A5.5, sans exception ni variante** — arme JS sur le
checkout existant, arme Go au commit épinglé avec garde de fraîcheur warn-only ;
verdict divergent bloquant, corpus amont plus récent que le pin en avertissement.

**L'asymétrie a une adresse** : le `ref: main` flottant du job `conformance` de ce
dépôt est épinglé par **Lumencast/lumencast-js#109** (issue d'A5.5, déjà ouverte). Ce
texte en **dépend** et ne la redouble pas. À noter, parce que la note de review d'A5.5
le relevait sans que le texte accepté le porte : tant que #109 n'est pas livrée, la
doctrine pin + garde ne tient que sur une arme sur deux, et une divergence JS se lit
comme un défaut du corpus au lieu d'un défaut de pin.

### 3.5 Les copies internes cessent d'être « tenues en sync »

`packages/protocol/src/conformance/bundle-hash.ts` est une copie de
`@lumencast/compiler` maintenue par un commentaire, pour contourner une dépendance
circulaire de workspace. Deux réponses possibles : la faire passer par les vecteurs,
ou la supprimer.

**Elles ont déjà divergé au-delà du défaut commun**, ce qui tranche la question :
`hashInlineBundle` (`bundle-hash.ts:14-23`) ne substitue le placeholder `scene_version`
**que** si l'entrée est un objet non-tableau, là où `hashBundle`
(`canonicalize.ts:19-29`) le fait inconditionnellement sur un type qui l'impose. Le
commentaire « keep the two in sync » a donc déjà échoué, sur un point que personne
n'avait signalé — et c'est le meilleur argument disponible contre l'option « copie qui
passe les vecteurs ».

**Décision : la supprimer** — extraire le canonicaliseur dans un **paquet feuille sans
dépendance interne**, `@lumencast/canonical` (nom à confirmer à l'implémentation, mais
il en faut un : « un paquet feuille » sans nom se négocie encore en revue), que
`compiler` et `protocol` importent tous deux. Une copie qui passe les vecteurs reste
une copie : elle divergera au prochain correctif appliqué d'un seul côté, et les
vecteurs ne l'attraperont qu'**après**. L'extraction l'empêche.

Les vecteurs restent nécessaires — ils tiennent les implémentations qu'on ne contrôle
pas, à commencer par le Go. Extraction et vecteurs ne se remplacent pas : l'une
supprime une dérive possible, l'autre détecte celles qui restent.

### 3.6 Ce que cet ADR ne décide pas

- **Le correctif du canonicaliseur TS.** Hacher la forme sérialisée plutôt que l'objet
  en mémoire est un **bug contre la spec** (§1.4), routé à Forge séparément. Ce texte
  ne le décide pas, il le rend vérifiable.
- **Le sort des bundles déjà stockés — question ouverte, et elle est bloquante pour le
  déploiement du correctif.** Les 19 bundles ont été adressés avec la forme fautive :
  leur adresse en base ne sera **pas** reproduite par le canonicaliseur corrigé.
  Aujourd'hui la divergence coûte des `defaults` abandonnés (dégradation) ; après
  correctif, selon le chemin, elle peut coûter un **refus dur** à l'admission ou au
  round-trip. **Cette question doit être tranchée avant le déploiement du correctif,
  pas après** — sinon 19 dégradations deviennent 19 échecs. Elle appartient à
  ZabCanvas et Orion, pas au protocole : issue dédiée, avec Bastion et Conduit.
- **Le `content_hash` d'authoring de ZabCanvas** (ADR 010 §3.1) : identifiant interne,
  opaque, délibérément **non**-JCS. Il ne s'agit ni du même objet, ni du même
  hachage, ni du même usage que l'adresse de bundle. La confusion entre les deux est
  exactement du genre de celle qui a produit cet incident — d'où cette ligne.

## 4. Consequences

**Ce qui devient possible.** Une implémentation nouvelle peut prouver sa conformité
d'adressage sans lire une ligne du TS ni du Go. Et une divergence se découvre au
premier run de CI, pas par un audit six semaines plus tard.

**Ce que ça coûte.**

- **Un corpus à produire et à relire à la main** (§3.2). C'est le seul travail
  irréductible du texte : la valeur d'un vecteur tient entièrement au sérieux de sa
  relecture initiale.
- **Une extraction de paquet** (§3.5) — mécanique, mais elle touche la frontière
  `compiler`/`protocol` et sa dépendance circulaire.
- **Une question ouverte à trancher avant déploiement** (§3.6, les bundles existants),
  qui n'était pas visible avant ce cadrage.

**Ce qui ne bouge pas.** La spec (aucune modification : ce texte l'_applique_, il ne
l'amende pas — donc pas de RFC au sens de `RFC-PROCESS.md`), le garde d'Orion et sa
dissymétrie, le refus d'un canonicaliseur Python côté ZabCanvas.

## 5. Risks

| #   | Risque                                                                                                                            | Portée    | Traitement                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Le corpus est produit par un générateur non relu : il fige une erreur en contrat, avec l'autorité d'un fichier « de référence ».  | **Haute** | §3.2 : relecture manuelle des premiers vecteurs contre le texte de la RFC, et repli explicite sur un corpus figé à la main. Un `expected` faux est pire que pas de vecteur — il rend faux tout ce qui s'y conforme. |
| R2  | Le corpus se remplit de cas nominaux et devient une conformance verte et vide.                                                    | Moyenne   | §3.3 nomme les pièges plutôt que les cas ; un vecteur sans piège nommé dans sa `note` n'a pas sa place.                                                                                                             |
| R3  | L'arme Go n'est jamais câblée : le TS se conforme seul, ce qui ne prouve rien sur la paire.                                       | **Haute** | RC 4 exige les deux armes vertes sur les mêmes octets. Une seule arme est un test unitaire déguisé en contrat.                                                                                                      |
| R4  | Le correctif TS est déployé avant que le sort des bundles existants soit tranché.                                                 | **Haute** | §3.6 le pose en question bloquante et nommée, avec sa conséquence chiffrée (dégradation → refus dur). C'est la seule ligne de ce texte qui contraint un calendrier.                                                 |
| R5  | L'extraction du canonicaliseur (§3.5) casse la frontière `compiler`/`protocol` ou réintroduit la circularité par un autre chemin. | Basse     | Paquet feuille, sans dépendance interne ; la conformance elle-même le vérifie, puisque les deux consommateurs exécutent les mêmes vecteurs.                                                                         |

## 6. Resolution criteria (testables)

1. **Le vecteur du bug existe et discrimine.** Deux vecteurs — l'un avec un membre
   absent, l'autre avec le même membre à `null` — portent des `expected` **différents**.
2. **La propriété de §3.1 bis échoue avant correctif et passe après.**
   `hash(x) == hash(JSON.parse(JSON.stringify(x)))` sur `x = {a: undefined, b: 1}` est
   **rouge** sur le canonicaliseur d'aujourd'hui, **vert** après. C'est ce critère, et
   **pas un vecteur**, qui démontre la non-régression dans les deux sens — un vecteur
   chargé par `JSON.parse` ne peut pas contenir d'`undefined`, donc ne peut pas
   distinguer les deux versions du code (§3.1 bis).
   2 bis. **La propriété est générique, pas taillée sur le cas connu** : elle échoue aussi
   sur une valeur portant `toJSON`, sur une fonction et sur un symbole — sinon c'est le
   test d'un bug, pas d'un invariant.
3. **Chaque piège de §3.3 a au moins un vecteur**, et chaque vecteur porte une `note`
   disant lequel — un test de couverture du corpus par lui-même.
   3 bis. **Le format de §3.1 est complet et vérifié** : chaque vecteur porte `input`,
   `substitute_scene_version`, `canonical` et `expected` ; un vecteur auquel il manque
   un champ fait échouer la validation du corpus. Et `canonical` est **asserté**, pas
   seulement présent : une arme dont la forme canonique diverge échoue **même si son
   `expected` coïncide**.
4. **Les deux armes sont vertes sur les mêmes octets** : `pnpm conformance`
   (`lumencast-js`) et l'arme Go exécutent le même fichier et rendent le même verdict
   vecteur par vecteur.
5. **Un verdict divergent est bloquant, un pin périmé est un avertissement** —
   règle d'A5.5, prouvée ici par une divergence artificielle sur une arme.
6. **Il n'existe plus qu'un canonicaliseur TS dans le dépôt, et la détection est
   mécanique.** `bundle-hash.ts` n'exporte plus de `canonicalize`/`stringify` propre et
   ré-exporte le paquet feuille. La garde anti-réapparition est explicite : **aucun
   fichier de `packages/**/src`autre que celui du paquet feuille ne définit de
fonction de sérialisation canonique** — vérifié par une règle de lint sur les
imports (seul le paquet feuille est autorisé à ne pas importer le canonicaliseur) ou
par un test qui échoue sur toute définition de`function stringify(`/`canonicalize(` hors de ce paquet. Le critère nomme la méthode parce qu'un « un test
   échoue si… » sans mécanisme ne se livre pas.
7. **`expected` est reproductible** : rejouer le script de génération sur le corpus
   versionné produit des octets identiques, sinon le générateur n'est pas un oracle.

## 7. Découpe en issues

L'ordre est contraignant : l'issue 1 précède tout, l'issue 4 précède le déploiement du
correctif producteur.

| #   | Dépôt                  | Titre                                                                                                                         | RC       |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **lumencast-protocol** | Corpus `bundle-address` : vecteurs, générateur, relecture manuelle des premiers                                               | 1, 3, 7  |
| 2   | **lumencast-js**       | Arme TS + **extraction du canonicaliseur en paquet feuille** (fin de la copie « keep in sync »)                               | 2, 4, 6  |
| 3   | **lumencast-go**       | Arme Go — commit épinglé + garde de fraîcheur (règles A5.5)                                                                   | 4, 5     |
| 4   | **ZabCanvas / Orion**  | **Trancher le sort des bundles déjà adressés avec la forme fautive**, avant tout déploiement du correctif — Bastion + Conduit | — (§3.6) |

**Dispatch recommandé : Forge** pour 1, 2 et 3 — aucun contrat inter-services ne
bouge, ce sont des fixtures et des tests. L'issue 4 n'est pas une issue de Forge :
c'est un arbitrage de migration de données, à porter par **Conduit** (frontière
Canvas↔Orion) avec **clearance Bastion**, et c'est la seule des quatre qui bloque un
calendrier.
