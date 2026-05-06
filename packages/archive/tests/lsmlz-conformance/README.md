# LSMLZ/1 conformance

Test cases for [LSMLZ/1](../../spec/LSMLZ-1.md) reader and writer implementations.

LSMLZ is a file format ; conformance is checked by feeding fixed byte sequences into a reader and asserting the produced `{ lsmlBytes, assets[] }` (or appropriate error) matches the expected result. This differs from the LSDP/LSML conformance suite under `../v1/` which uses YAML scenarios describing wire-protocol exchanges.

## Layout

```
lsmlz/
├── README.md                                  ← this file
├── manifest.json                              ← case index (machine-readable)
└── cases/
    ├── valid/                                 ← cases the reader MUST accept
    │   └── <case-id>.yaml                     ← case spec (see below)
    ├── invalid/                               ← cases the reader MUST reject
    │   └── <case-id>.yaml
    └── advisory/                              ← cases the reader MAY reject (SHOULD ignore)
        └── <case-id>.yaml
```

## Case file format

Each `<case-id>.yaml` describes one test :

```yaml
name: minimal-archive-roundtrips
description: One bundle entry + one asset entry pack and unpack to the same byte content.
tag: required # required | recommended | extended
spec_refs:
  - LSMLZ-1#3.1
  - LSMLZ-1#3.2

# Either an archive synthesised from `entries` (preferred, deterministic), or a
# binary fixture under `fixtures/<case-id>.lsmlz`.
input:
  entries:
    "hello.lsml": |
      { "$schema": "...", "lsml": "1.1", "scene_id": "hello", ... }
    "assets/abc123.png": "BASE64::iVBORw0KGgo..."

# Expected result on a conforming reader.
expect:
  bundle_present: true
  bundle_filename: "hello.lsml"
  asset_paths:
    - "assets/abc123.png"
  warnings: []
```

For invalid cases :

```yaml
expect:
  reject: true
  code: LSMLZ_PATH_TRAVERSAL # one of the codes from LSMLZ-1#5.4
```

## Running

There is no canonical runner shipped here yet — implementations are expected to drive the cases themselves and surface a pass / fail per case ID. A reference TypeScript runner will land alongside `@lumencast/archive` once the case set is stable.

## Scope

Cases cover :

- §3.1 single bundle entry at root (positive + missing + multiple)
- §3.2 asset entries under `assets/`
- §3.3 reserved authoring prefixes (`_debug/` ignored, future prefix forward-compat)
- §3.4 forbidden entries (nested archives, symlinks, path traversal, NUL paths)
- §5.1 writer requirements (covered indirectly via roundtrip cases)
- §5.2 reader requirements (covered directly)
- §5.4 error code surfacing
- §2.4 magic-byte detection

Out of scope (covered by LSML/LSDP conformance) :

- LSML schema validation of the bundle entry's content (use LSML conformance)
- `scene_version` recomputation (use LSML §3.2 conformance)
