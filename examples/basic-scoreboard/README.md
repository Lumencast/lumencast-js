# basic-scoreboard

5-minute hello-world for Lumencast: a scoreboard scene whose `home` / `away` scores tick every 2 seconds.

## Run the server

```bash
pnpm install                  # at the repo root
pnpm --filter @lumencast/example-basic-scoreboard start
```

The script prints the WebSocket URL, HTTP URL, and the bundle URL.

## Run a runtime against it

In a browser page, mount `@lumencast/runtime`:

```html
<div id="stage" style="width:100vw;height:100vh"></div>
<script type="module">
  import { mount } from "@lumencast/runtime";

  mount({
    target: document.getElementById("stage"),
    serverUrl: "ws://127.0.0.1:NNNNN/lsdp/v1", // ← from the script's stdout
    token: "anything", // dev-server accepts any token
    mode: "broadcast",
  });
</script>
```

Or, after `pnpm --filter @lumencast/runtime build`, point the production HTML at the dev-server:

```
file:///path/to/lumencast-js/packages/runtime/dist/index.html?server=ws%3A%2F%2F127.0.0.1%3ANNNNN%2Flsdp%2Fv1&token=any&mode=broadcast
```

## What you should see

The two scores update in place every 2 s, with no full re-render — only the `text` primitives bound to `score.home` and `score.away` re-render. After 10 s the script shuts down the server.
