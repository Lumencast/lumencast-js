#!/usr/bin/env node
// Cross-language interop self-test for lumencast-js.
//
// Spawns `node packages/server/dist/cli.js serve-scenario` then drives it
// with `node packages/protocol/dist/cli.js conformance`. Exits with the
// harness's exit code (0 on all-pass).
//
// Used by:
//   - manual local validation: `node scripts/interop-self-test.mjs`
//   - CI integration job (.github/workflows/ci.yml)
//
// Env:
//   LUMENCAST_PROTOCOL_REPO — path to the lumencast-protocol checkout (default: ../lumencast-protocol)

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SERVER_CLI = resolve(REPO_ROOT, "packages/server/dist/cli.js");
const HARNESS_CLI = resolve(REPO_ROOT, "packages/protocol/dist/cli.js");

const protocolRepo =
  process.env["LUMENCAST_PROTOCOL_REPO"] ?? resolve(REPO_ROOT, "..", "lumencast-protocol");

async function main() {
  const server = spawn(
    process.execPath,
    [SERVER_CLI, "serve-scenario", "--ws-port", "0", "--test-control-port", "0"],
    { stdio: ["ignore", "pipe", "inherit"] },
  );

  let discovery = "";
  let resolvedDiscovery;
  const discoveryPromise = new Promise((res, rej) => {
    resolvedDiscovery = res;
    setTimeout(() => rej(new Error("discovery timeout (15s)")), 15000);
  });
  server.stdout.on("data", (chunk) => {
    discovery += chunk.toString();
    const line = discovery.split("\n").find((l) => l.includes("control_url"));
    if (line) resolvedDiscovery(JSON.parse(line));
  });

  let urls;
  try {
    urls = await discoveryPromise;
  } catch (err) {
    server.kill("SIGTERM");
    process.stderr.write(`interop-self-test: ${err.message}\n`);
    process.exit(1);
  }

  process.stderr.write(
    `[interop-self-test] server up: ws=${urls.ws_url} control=${urls.control_url}\n`,
  );

  const harness = spawn(
    process.execPath,
    [HARNESS_CLI, "conformance", "--server", urls.ws_url, "--control-url", urls.control_url],
    {
      stdio: "inherit",
      env: { ...process.env, LUMENCAST_PROTOCOL_REPO: protocolRepo },
    },
  );

  const code = await new Promise((res) => {
    harness.on("exit", (code) => res(code ?? 1));
  });

  server.kill("SIGTERM");
  await new Promise((res) => server.on("exit", () => res()));

  process.exit(code);
}

main().catch((err) => {
  process.stderr.write(`interop-self-test: ${err.stack ?? err}\n`);
  process.exit(1);
});
