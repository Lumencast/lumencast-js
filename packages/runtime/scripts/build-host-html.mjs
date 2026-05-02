#!/usr/bin/env node
/**
 * Generates dist/index.html — the production bootstrap consumed by CEF
 * browser sources, OBS, and any other host that loads the bundle as a
 * static URL.
 *
 * Run as the second step of `pnpm build` after `vite build`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const distDir = resolve(root, "dist");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

mkdirSync(distDir, { recursive: true });

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="generator" content="@lumencast/runtime ${pkg.version}" />
    <title>Lumencast</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #000; }
      #scene { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="scene" data-testid="lumencast-scene-root"></div>
    <script type="module">
      import { mount } from "./lumencast.js";

      const params = new URLSearchParams(window.location.search);
      const serverUrl = params.get("server") ?? \`wss://\${location.host}/lsdp/v1\`;
      const token = params.get("token") ?? "";
      const modeParam = params.get("mode") ?? "broadcast";
      const mode = ["broadcast", "control", "test"].includes(modeParam) ? modeParam : "broadcast";
      const scene = params.get("scene") ?? undefined;
      const testSession = params.get("session") ?? undefined;

      const target = document.getElementById("scene");
      if (!(target instanceof HTMLElement)) {
        document.body.textContent = "lumencast host: #scene target missing";
        throw new Error("lumencast host: #scene target missing");
      }

      mount({
        target,
        serverUrl,
        token,
        mode,
        ...(mode === "test" && scene ? { scene } : {}),
        ...(mode === "test" && testSession ? { testSession } : {}),
        onError: (err) => {
          // Broadcast hosts must not surface chrome — log only.
          console.error("[lumencast]", err);
        },
      });
    </script>
  </body>
</html>
`;

const target = resolve(distDir, "index.html");
writeFileSync(target, html);
const bytes = Buffer.byteLength(html, "utf8");
console.log(`lumencast host html  : ${bytes} B raw at ${target}`);
