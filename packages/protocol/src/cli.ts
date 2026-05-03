#!/usr/bin/env node
// lumencast-js conformance CLI.
//
// Subcommands:
//   conformance --server <ws-url> --control-url <http-url>
//                [--scenarios-dir <path>] [--tag required]
//                [--scenario <name>] [--timeout 60s]
//
// Walks every scenario whose tag matches `--tag` (default required) under
// `<scenarios-dir>` (defaults to <env LUMENCAST_PROTOCOL_REPO>/conformance/v1/scenarios)
// and runs the harness against the supplied server + control plane.
//
// Exit code: 0 if all PASS, 1 if any FAIL.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Harness, loadScenarios, type Report, type Tag } from "./conformance/index.js";

async function main(argv: string[]): Promise<number> {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h") {
    printUsage();
    return sub ? 0 : 2;
  }
  if (sub === "conformance") return cmdConformance(argv.slice(1));
  process.stderr.write(`lumencast-js: unknown subcommand "${sub}"\n`);
  printUsage();
  return 2;
}

function printUsage(): void {
  process.stderr.write(
    [
      "usage: lumencast-js-conformance conformance <flags>",
      "",
      "  --server <ws-url>           WS endpoint (used if /test/setup doesn't return one)",
      "  --control-url <http-url>    HTTP test control plane root (required)",
      "  --scenarios-dir <path>      directory containing scenario YAMLs",
      "                              default: $LUMENCAST_PROTOCOL_REPO/conformance/v1/scenarios",
      "  --tag <required|recommended|extended>   default: required",
      "  --scenario <name>           run a single scenario (basename without .yaml)",
      "  --timeout <ms>              total run timeout, default 60000",
      "",
    ].join("\n"),
  );
}

async function cmdConformance(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        server: { type: "string" },
        "control-url": { type: "string" },
        "scenarios-dir": { type: "string" },
        tag: { type: "string", default: "required" },
        scenario: { type: "string" },
        timeout: { type: "string", default: "60000" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    process.stderr.write(`conformance: ${(err as Error).message}\n`);
    return 2;
  }

  if (parsed.values["help"]) {
    printUsage();
    return 0;
  }

  const controlUrl = parsed.values["control-url"] as string | undefined;
  if (!controlUrl) {
    process.stderr.write("--control-url required\n");
    return 2;
  }
  const serverUrl = parsed.values["server"] as string | undefined;
  const tagRaw = parsed.values["tag"] as string;
  if (tagRaw !== "required" && tagRaw !== "recommended" && tagRaw !== "extended") {
    process.stderr.write(`--tag must be required|recommended|extended, got ${tagRaw}\n`);
    return 2;
  }
  const tag: Tag = tagRaw;

  const scenariosDir = resolveScenariosDir(parsed.values["scenarios-dir"] as string | undefined);
  if (!scenariosDir) return 2;

  const timeoutMs = Number.parseInt(parsed.values["timeout"] as string, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    process.stderr.write(`--timeout invalid\n`);
    return 2;
  }

  let scenarios;
  try {
    scenarios = loadScenarios({
      scenariosDir,
      ...(parsed.values["scenario"] ? { scenarioName: parsed.values["scenario"] as string } : {}),
    });
  } catch (err) {
    process.stderr.write(`load: ${(err as Error).message}\n`);
    return 2;
  }

  const harness = new Harness({
    ...(serverUrl ? { serverUrl } : {}),
    controlUrl,
  });

  const deadline = setTimeout(() => {
    process.stderr.write(`conformance: timeout ${timeoutMs}ms exceeded\n`);
    process.exit(1);
  }, timeoutMs);
  deadline.unref();

  const report = await harness.runAll(scenarios, tag);

  printReport(report);

  return report.failed > 0 ? 1 : 0;
}

function resolveScenariosDir(flag: string | undefined): string | null {
  if (flag) return resolve(flag);
  const repo = process.env["LUMENCAST_PROTOCOL_REPO"];
  if (repo) return resolve(repo, "conformance/v1/scenarios");
  // Fallback: try several candidates so the CLI works whether it is
  // invoked from the lumencast-js root, from inside the lumencast-protocol
  // checkout (e.g. interop/run-matrix.sh), or from a parallel directory
  // structure. Returns the first candidate that resolves to an existing
  // directory ; falls back to the canonical sibling layout so the error
  // message still points at the expected path.
  const cwd = process.cwd();
  const candidates = [
    // Already inside a lumencast-protocol checkout (cwd is interop/, scripts/, …).
    resolve(cwd, "../conformance/v1/scenarios"),
    resolve(cwd, "conformance/v1/scenarios"),
    // Sibling of the monorepo (the original heuristic).
    resolve(cwd, "../lumencast-protocol/conformance/v1/scenarios"),
    // Parent-of-parent sibling (helps when invoked from a deeper dist/ shim).
    resolve(cwd, "../../lumencast-protocol/conformance/v1/scenarios"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[2] ?? candidates[0] ?? null;
}

function printReport(rep: Report): void {
  process.stdout.write(
    `Conformance report — ${rep.total} total, ${rep.passed} passed, ${rep.failed} failed, ${rep.skipped} skipped\n`,
  );
  for (const r of rep.results) {
    if (r.outcome === "PASS") {
      process.stdout.write(`  PASS  ${r.name} [${r.tag}/${r.target}]\n`);
    } else if (r.outcome === "SKIP") {
      process.stdout.write(`  SKIP  ${r.name} — ${r.reason ?? "filtered"}\n`);
    } else {
      process.stdout.write(`  FAIL  ${r.name} [${r.tag}/${r.target}] — ${r.reason ?? "unknown"}\n`);
    }
  }
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
