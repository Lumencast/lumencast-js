// ADR 005 RC 6 — there is only one TS canonicalizer in the repo, and the
// detection is mechanical.
//
// Two copies existed, kept in sync by a comment. They drifted, and the same
// defect then had to be fixed twice (#108, #111). This test is what stops a
// third copy: any file under packages/*/src that defines a canonical serializer
// of its own, outside this package, fails it.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const PACKAGES = resolve(REPO_ROOT, "packages");
const OWNER = resolve(PACKAGES, "canonical", "src");

// Named definitions of a canonical serializer. A copy that renames everything
// is out of reach of any textual rule — that is what the conformance vectors
// and the producer property are for; this guard covers the copy-paste case,
// which is the one that actually happened.
const DEFINITIONS = [
  /\bfunction\s+stringify\s*\(/,
  /\bfunction\s+canonicalize\s*\(/,
  /\bconst\s+stringify\s*=/,
  /\bconst\s+canonicalize\s*=/,
];

const PRUNED = new Set(["node_modules", "dist", "coverage", ".tsbuildinfo"]);

/** Walks the `src` of every package, pruning as it goes — a recursive readdir
 *  of the whole tree descends into every node_modules and takes tens of seconds. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const stack = readdirSync(PACKAGES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !PRUNED.has(e.name))
    .map((e) => resolve(PACKAGES, e.name, "src"))
    .filter((dir) => existsSync(dir));

  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (!PRUNED.has(entry.name)) stack.push(full);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  }
  return out;
}

describe("a single canonicalizer (ADR 005 RC 6)", () => {
  it("finds the source tree it is meant to police", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.startsWith(OWNER))).toBe(true);
  });

  it("no package outside @lumencast/canonical defines one", () => {
    const offenders = sourceFiles()
      .filter((f) => !f.startsWith(OWNER))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return DEFINITIONS.some((re) => re.test(src));
      })
      .map((f) => relative(REPO_ROOT, f));

    expect(offenders).toEqual([]);
  });

  it("the guard would catch a reappearance", () => {
    const copy = "export function canonicalize(value: unknown): string { return ''; }";
    expect(DEFINITIONS.some((re) => re.test(copy))).toBe(true);
  });
});
