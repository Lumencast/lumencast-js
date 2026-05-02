// Hello-world for @lumencast/runtime + @lumencast/dev-server.
//
// What it does (Node script):
//   1. Boot a dev-server on a random port with a tiny scoreboard scene.
//   2. Print the WS + HTTP URLs.
//   3. Tick scores every 2 seconds for 10 seconds, then shut down.
//
// In a browser host (CEF, OBS, iframe), the runtime side would be:
//
//     import { mount } from "@lumencast/runtime";
//     mount({
//       target: document.getElementById("stage")!,
//       serverUrl: "<wsUrl from this script>",
//       token: "anything",
//       mode: "broadcast",
//     });
//
// Open that page while this script is running and watch the scores update.

import { startDevServer } from "@lumencast/dev-server";
import bundle from "./bundle.json" with { type: "json" };

const server = await startDevServer({
  port: 0,
  initialSceneId: "scoreboard",
  initialSceneVersion: "sha256:basic-scoreboard-v0",
  initialBundle: bundle,
  initialState: {
    "show.title": "Lumencast Cup",
    "score.home": 0,
    "score.away": 0,
  },
});

console.log(`▶ dev-server WS:   ${server.wsUrl}`);
console.log(`▶ dev-server HTTP: ${server.httpUrl}`);
console.log(
  `▶ bundle URL:      ${server.httpUrl}/lsdp/v1/scenes/scoreboard/bundle?v=sha256:basic-scoreboard-v0`,
);

let home = 0;
let away = 0;
const interval = setInterval(() => {
  if (Math.random() < 0.5) home += 1;
  else away += 1;
  server.pushDelta([
    { path: "score.home", value: home },
    { path: "score.away", value: away },
  ]);
  console.log(`δ score.home=${home} score.away=${away}`);
}, 2000);

setTimeout(async () => {
  clearInterval(interval);
  await server.close();
  console.log("✓ done");
}, 10000);
