// Dev entry point — only used during `vite dev` and Playwright E2E tests.
// Reads URL query params, calls mount(). Mirrors the production
// build-host-html.mjs behavior so tests exercise a real bootstrap.

import { mount } from "./index.js";
import type { LumencastMode } from "./types.js";

const params = new URLSearchParams(window.location.search);
const serverUrl = params.get("server") ?? `ws://${location.host}/lsdp/v1`;
const token = params.get("token") ?? "any";
const modeParam = params.get("mode") ?? "broadcast";
const mode: LumencastMode = (["broadcast", "control", "test"] as const).includes(
  modeParam as LumencastMode,
)
  ? (modeParam as LumencastMode)
  : "broadcast";
const scene = params.get("scene") ?? undefined;
const testSession = params.get("session") ?? undefined;

const target = document.getElementById("scene");
if (!(target instanceof HTMLElement)) {
  document.body.textContent = "lumencast dev: #scene target missing";
  throw new Error("dev-entry: #scene missing");
}

const handle = mount({
  target,
  serverUrl,
  token,
  mode,
  ...(mode === "test" && scene ? { scene } : {}),
  ...(mode === "test" && testSession ? { testSession } : {}),
  onError: (err) => console.error("[lumencast]", err),
  onStatus: (status) => target.setAttribute("data-status", status),
});

// Expose the handle to Playwright tests for setToken/disconnect drills.
(window as unknown as { __lumencast: typeof handle }).__lumencast = handle;
