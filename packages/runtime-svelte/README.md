# @lumencast/runtime-svelte

> Headless Svelte adapter for Lumencast — live LSDP/1 leaf state exposed as Svelte stores.

This package gives Svelte apps reactive bindings into a Lumencast scene's leaf state. It does not render — bring your own Svelte components and use the stores wherever you need live values.

## Install

```bash
pnpm add @lumencast/runtime-svelte @lumencast/protocol
```

## Use

```ts
import { createLumencastClient, leaf } from "@lumencast/runtime-svelte";

const client = createLumencastClient({
  serverUrl: "wss://example.com/lsdp/v1",
  token: "<jwt>",
  sceneId: "scoreboard",
});

const homeScore = leaf<number>(client, "score.home");
```

```svelte
<script lang="ts">
  import { homeScore } from "./client";
</script>

<h1>Home : {$homeScore ?? 0}</h1>
```

The store updates on every LSDP/1 delta that touches `score.home` — Svelte's reactivity handles the rest.

## Repository

[github.com/Lumencast/lumencast-js](https://github.com/Lumencast/lumencast-js/tree/main/packages/runtime-svelte)

## License

Apache-2.0
