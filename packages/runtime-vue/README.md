# @lumencast/runtime-vue

> Headless Vue 3 adapter for Lumencast — live LSDP/1 leaf state exposed as Vue refs.

This package gives Vue 3 apps reactive bindings into a Lumencast scene's leaf state. It does not render — bring your own Vue components and use the refs wherever you need live values.

## Install

```bash
pnpm add @lumencast/runtime-vue @lumencast/protocol
```

## Use

```ts
import { createLumencastClient, useLeaf } from "@lumencast/runtime-vue";

const client = createLumencastClient({
  serverUrl: "wss://example.com/lsdp/v1",
  token: "<jwt>",
  sceneId: "scoreboard",
});
```

```vue
<script setup lang="ts">
import { useLeaf } from "@lumencast/runtime-vue";
import { client } from "./client";

const homeScore = useLeaf<number>(client, "score.home");
</script>

<template>
  <h1>Home : {{ homeScore ?? 0 }}</h1>
</template>
```

The ref updates on every LSDP/1 delta that touches `score.home` — Vue's reactivity handles the rest.

## Repository

[github.com/Lumencast/lumencast-js](https://github.com/Lumencast/lumencast-js/tree/main/packages/runtime-vue)

## License

Apache-2.0
