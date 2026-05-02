// Conference-board demo using @lumencast/server.
//
// Stands up a real (non-mock) Lumencast server: routes /lsdp/v1 (WS) and
// /lsdp/v1/scenes/conference/bundle?v=... (HTTP). Simulates an audience
// dropping questions and casting votes; the server pushes deltas to anyone
// connected.

import { createScene, startServer } from "@lumencast/server";
import bundle from "./bundle.json" with { type: "json" };

const scene = createScene({
  sceneId: "conference",
  sceneVersion: "sha256:conference-board-v0",
  initialState: {
    "session.title": "Lumencast Day — Keynote",
    "qa.count": 0,
    "qa.next": "—",
    "votes.total": 0,
  },
});

const server = await startServer({
  port: 0,
  scene,
  bundleProvider: () => bundle,
  authenticate: (token) => ({
    role: token === "operator" ? "operator" : "viewer",
  }),
});

console.log(`▶ server WS:   ${server.wsUrl}`);
console.log(`▶ server HTTP: ${server.httpUrl}`);
console.log(
  `▶ bundle URL:  ${server.httpUrl}/lsdp/v1/scenes/conference/bundle?v=sha256:conference-board-v0`,
);

const audience = [
  "Why leaf-grain over diff-DOM?",
  "Roadmap for WebGL primitive?",
  "How does test session isolation work?",
  "Will there be a Vue runtime?",
];

let qaCount = 0;
let votes = 0;

const interval = setInterval(() => {
  qaCount += 1;
  votes += Math.floor(Math.random() * 8) + 1;
  const idx = Math.floor(Math.random() * audience.length);
  scene.update({
    "qa.count": qaCount,
    "qa.next": audience[idx] ?? "—",
    "votes.total": votes,
  });
  console.log(`δ qa=${qaCount} votes=${votes} next="${audience[idx]}"`);
}, 1500);

setTimeout(async () => {
  clearInterval(interval);
  await server.close();
  console.log("✓ done");
}, 12000);
