// Filesystem loader for scenarios. Reads YAML files from disk by path. The
// CLI uses this to find scenarios under `lumencast-protocol/conformance/v1/scenarios/`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseScenario, type Scenario } from "./scenario.js";

export interface LoadOptions {
  /** Directory containing the *.yaml scenarios. Required. */
  scenariosDir: string;
  /** When set, only load this single scenario (basename without .yaml). */
  scenarioName?: string;
}

export function loadScenarios(opts: LoadOptions): Scenario[] {
  const dir = resolve(opts.scenariosDir);
  const stat = statSync(dir, { throwIfNoEntry: false });
  if (!stat || !stat.isDirectory()) {
    throw new Error(`scenarios directory not found: ${dir}`);
  }

  let files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (opts.scenarioName) {
    files = files.filter(
      (f) => f === `${opts.scenarioName}.yaml` || f === `${opts.scenarioName}.yml`,
    );
    if (files.length === 0) {
      throw new Error(`scenario not found in ${dir}: ${opts.scenarioName}`);
    }
  }
  files.sort();

  const out: Scenario[] = [];
  for (const f of files) {
    const raw = readFileSync(join(dir, f), "utf8");
    out.push(parseScenario(raw));
  }
  return out;
}
