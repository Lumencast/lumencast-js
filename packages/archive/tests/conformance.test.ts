// Drives the LSMLZ/1 conformance suite (lumencast-protocol/conformance/lsmlz/)
// against this package's APIs. Cases are vendored under
// `tests/lsmlz-conformance/` ; the runner lives in `src/conformance.ts`.
//
// Sync source : on each LSMLZ-1 spec change, copy the latest YAML cases
// from `lumencast-protocol/conformance/lsmlz/cases/{valid,invalid}/`
// into the matching `tests/lsmlz-conformance/cases/{valid,invalid}/`
// directory here. Diffing the manifest.json is the easiest sanity check.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { runCaseFile, type CaseFile } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const conformanceRoot = join(here, "lsmlz-conformance");

interface ManifestEntry {
  id: string;
  path: string;
  tag: "required" | "recommended" | "extended";
  covers: string[];
}

interface Manifest {
  version: string;
  spec: { lsmlz: string };
  cases: ManifestEntry[];
}

const manifestRaw = readFileSync(join(conformanceRoot, "manifest.json"), "utf-8");
const manifest = JSON.parse(manifestRaw) as Manifest;

describe(`LSMLZ/${manifest.spec.lsmlz} conformance suite (vendored from lumencast-protocol)`, () => {
  it(`manifest declares ${manifest.cases.length} cases`, () => {
    expect(manifest.cases.length).toBeGreaterThan(0);
  });

  for (const entry of manifest.cases) {
    describe(`case : ${entry.id} (${entry.tag})`, () => {
      const caseRaw = readFileSync(join(conformanceRoot, entry.path), "utf-8");
      const caseFile = yaml.load(caseRaw) as CaseFile;
      const results = runCaseFile(caseFile);

      for (const result of results) {
        it(result.name, () => {
          if (!result.pass) {
            throw new Error(result.reason ?? "case failed without a reason");
          }
          expect(result.pass).toBe(true);
        });
      }
    });
  }
});
