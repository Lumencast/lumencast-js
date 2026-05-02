// Boots @lumencast/dev-server on a fixed port for the e2e suite.
// Tests reach it via process.env.E2E_LUMENCAST_WS / _HTTP.
//
// Tests that need the production-shaped @lumencast/server boot it themselves
// in a beforeAll hook — Playwright workers don't share globalThis with this
// global-setup, so a per-suite server kit is the cleanest pattern.

import { startDevServer, type DevServer } from "@lumencast/dev-server";
import { BUNDLE, INITIAL_STATE, SCENE_ID, SCENE_VERSION } from "./fixtures/scoreboard";

declare global {
  var __lumencastE2EDevServer: DevServer | undefined;
}

const MOCK_PORT = Number(process.env["E2E_LUMENCAST_PORT"] ?? 51320);

async function globalSetup(): Promise<void> {
  const server = await startDevServer({
    port: MOCK_PORT,
    initialSceneId: SCENE_ID,
    initialSceneVersion: SCENE_VERSION,
    initialBundle: BUNDLE,
    initialState: INITIAL_STATE,
  });
  globalThis.__lumencastE2EDevServer = server;
  process.env["E2E_LUMENCAST_WS"] = server.wsUrl;
  process.env["E2E_LUMENCAST_HTTP"] = server.httpUrl;
  console.log(`[lumencast-e2e] dev-server: WS=${server.wsUrl} HTTP=${server.httpUrl}`);
}

export default globalSetup;
