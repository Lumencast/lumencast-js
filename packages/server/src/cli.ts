#!/usr/bin/env node
// lumencast-js server CLI.
//
// Subcommands:
//   serve-scenario --ws-port N --test-control-port M [--host H]
//     Boots the LSDP/1 server with the interop test control plane on a
//     separate port. Prints exactly one JSON discovery line on stdout :
//     {"control_url":"http://...","ws_url":"ws://.../lsdp/v1"}
//     before any other output, then stays silent on stdout (logs go to stderr).

import { parseArgs } from "node:util";
import { createScene } from "./scene.js";
import { startServer, type ServerHandle } from "./server.js";
import { StaticTokens } from "./auth.js";
import { startTestControl, type TestControlHandle } from "./test-control.js";

async function main(argv: string[]): Promise<number> {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h") {
    printUsage();
    return sub ? 0 : 2;
  }
  if (sub === "serve-scenario") return cmdServeScenario(argv.slice(1));
  process.stderr.write(`lumencast-js: unknown subcommand "${sub}"\n`);
  printUsage();
  return 2;
}

function printUsage(): void {
  process.stderr.write(
    [
      "usage: lumencast-js <subcommand> [flags]",
      "",
      "subcommands:",
      "  serve-scenario --ws-port N --test-control-port M [--host H]",
      "    Boot LSDP/1 server + interop test control plane (separate ports).",
      "",
    ].join("\n"),
  );
}

async function cmdServeScenario(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        "ws-port": { type: "string" },
        "test-control-port": { type: "string" },
        host: { type: "string", default: "127.0.0.1" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    process.stderr.write(`serve-scenario: ${(err as Error).message}\n`);
    return 2;
  }

  if (parsed.values["help"]) {
    process.stderr.write("serve-scenario --ws-port N --test-control-port M [--host H]\n");
    return 0;
  }

  const wsPort = parseIntFlag(parsed.values["ws-port"], "--ws-port");
  const controlPort = parseIntFlag(parsed.values["test-control-port"], "--test-control-port");
  if (wsPort === null || controlPort === null) return 2;
  const host = (parsed.values["host"] as string | undefined) ?? "127.0.0.1";

  // Bootstrap a synthetic scene + empty bundle provider. Both are immediately
  // overridden by the first POST /test/setup.
  const initialScene = createScene({
    sceneId: "__interop_initial__",
    sceneVersion: "sha256:" + "0".repeat(64),
    initialState: {},
  });
  const auth = new StaticTokens();

  let server: ServerHandle;
  let control: TestControlHandle;
  try {
    server = await startServer({
      port: wsPort,
      host,
      scene: initialScene,
      bundleProvider: () => undefined,
      authenticate: auth.authenticate,
    });
  } catch (err) {
    process.stderr.write(`serve-scenario: bind ws: ${(err as Error).message}\n`);
    return 1;
  }
  try {
    control = await startTestControl({
      port: controlPort,
      host,
      server,
      auth,
    });
  } catch (err) {
    await server.close();
    process.stderr.write(`serve-scenario: bind control: ${(err as Error).message}\n`);
    return 1;
  }

  // Discovery line — written before any other stdout output. The matrix
  // driver greps for "control_url" to know we're ready.
  process.stdout.write(
    JSON.stringify({
      control_url: control.url,
      ws_url: server.wsUrl,
    }) + "\n",
  );

  let shutdown: (() => Promise<void>) | null = async () => {
    shutdown = null;
    process.stderr.write("[lumencast-js] shutting down\n");
    try {
      await control.close();
    } catch {
      // ignore
    }
    try {
      await server.close();
    } catch {
      // ignore
    }
  };

  process.on("SIGINT", () => void shutdown?.());
  process.on("SIGTERM", () => void shutdown?.());

  await new Promise<void>((resolve) => {
    const tick = (): void => {
      if (shutdown === null) resolve();
      else setTimeout(tick, 100);
    };
    tick();
  });

  return 0;
}

function parseIntFlag(raw: unknown, name: string): number | null {
  if (typeof raw !== "string") {
    process.stderr.write(`${name} required\n`);
    return null;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 65535) {
    process.stderr.write(`${name}: invalid port\n`);
    return null;
  }
  return n;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`lumencast-js: ${(err as Error).stack ?? String(err)}\n`);
    process.exitCode = 1;
  },
);
