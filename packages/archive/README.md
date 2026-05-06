# @lumencast/archive

LSMLZ/1 archive packer + unpacker. Single-file ZIP container that carries an LSML scene bundle plus its content-addressed assets.

Spec : [LSMLZ-1.md](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSMLZ-1.md).

## Install

```bash
pnpm add @lumencast/archive
```

## Usage

### Pack

```ts
import { packArchive } from "@lumencast/archive";
import { writeFileSync } from "node:fs";

const bytes = packArchive({
  sceneId: "hello",
  canonical: '{"$schema":"...","lsml":"1.1","scene_id":"hello",...}',
  assets: [
    { path: "assets/abc.png", bytes: imageBytes },
  ],
  // Optional — authoring-tool diagnostics under _debug/, ignored by readers.
  debug: { "trace.json": '{"build":[...]}' },
});

writeFileSync("hello.lsmlz", bytes);
```

### Unpack

```ts
import { unpackArchive, isArchive } from "@lumencast/archive";
import { readFileSync } from "node:fs";

const bytes = readFileSync("hello.lsmlz");
if (!isArchive(bytes)) {
  // bare .lsml JSON path — feed into LSML parser directly
}
const { lsmlBytes, assets } = unpackArchive(bytes);
const bundle = JSON.parse(lsmlBytes);
```

`unpackArchive` throws `LSMLZError` (with a `code` field from the [LSMLZ §5.4 taxonomy](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSMLZ-1.md#54-error-codes)) on archives that violate the spec — path traversal, nested archives, missing bundle entry, etc.

## What's in the archive

Per [LSMLZ §3](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSMLZ-1.md#3-layout) :

```
<scene_id>.lsml         UTF-8, JCS-canonicalized (LSML §3.1)
assets/<sha256>.<ext>   binary, content-addressed (LSML §11)
_debug/                 OPTIONAL — reserved for authoring tools, readers MUST ignore
```

Magic bytes `PK\x03\x04` (standard ZIP). Media type `application/lsml+zip`. File extension `.lsmlz`.

## What this package does NOT do

- Parse the LSML JSON. Use [`@lumencast/compiler`](../compiler) for that.
- Hash the bundle. Use the canonicalisation + hashing primitives in [`@lumencast/compiler`](../compiler).
- Resolve `bind.src` against the asset map. That's the consumer's job — `unpackArchive` returns the raw bytes keyed by their archive-relative path, which is also the bundle's `bind.src` reference.
- Make network calls. The package is purely byte-in / byte-out.

## License

Apache 2.0.
