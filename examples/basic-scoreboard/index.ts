// Hello-world for @lumencast/runtime + @lumencast/dev-server.
//
// What it does (Node script):
//   1. Boot a dev-server on a random port with a tiny scoreboard scene.
//   2. Serve a static demo HTML at the server's HTTP root so a browser
//      can render the scene live with no extra build/Vite step.
//   3. Print the URLs to copy into a browser.
//   4. Tick scores every 2 seconds for 60 seconds, then shut down.
//
// Demo flow:
//   $ pnpm --filter @lumencast/runtime build       # one-time
//   $ pnpm --filter @lumencast/example-basic-scoreboard start
//   ▶ open the printed httpUrl in a browser
//   → watch the scoreboard update live as deltas tick.
//
// The browser fetches /lumencast.js from this same dev-server and
// mounts it against the same WS endpoint — no CORS, no manual URL
// query param.

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
  demoHost: {
    title: "Lumencast — basic scoreboard",
  },
});

console.log("");
console.log(`▶ Open in a browser :  ${server.httpUrl}`);
console.log("");
console.log(`  WS    : ${server.wsUrl}`);
console.log(`  HTTP  : ${server.httpUrl}`);
console.log(
  `  bundle: ${server.httpUrl}/lsdp/v1/scenes/scoreboard/bundle?v=sha256:basic-scoreboard-v0`,
);
console.log("");
console.log("Ticking score deltas every 2s for 60s. Ctrl-C to quit.");
console.log("");

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
}, 60000);

process.on("SIGINT", async () => {
  clearInterval(interval);
  await server.close();
  console.log("\n✓ shutdown");
  process.exit(0);
});
