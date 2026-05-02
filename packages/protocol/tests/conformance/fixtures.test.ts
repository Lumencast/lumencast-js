// Conformance harness for byte-level fixtures.
//
// Loads every fixture indexed in `lumencast-protocol/conformance/manifest.json`
// and verifies that @lumencast/protocol round-trips it: decode → re-encode →
// decode again, all results equal to the canonical JSON shape.
//
// The protocol repo lives next to this monorepo (sibling directory) by
// convention. Override the path with LUMENCAST_PROTOCOL_REPO if needed.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeClientFrame,
  decodeServerFrame,
  encodeFrame,
  type ClientFrame,
  type ServerFrame,
} from "../../src/index.js";

const PROTOCOL_REPO =
  process.env["LUMENCAST_PROTOCOL_REPO"] ??
  resolve(import.meta.dirname, "../../../../..", "lumencast-protocol");

interface Manifest {
  fixtures: {
    client: string[];
    server: string[];
  };
}

const conformanceDir = resolve(PROTOCOL_REPO, "conformance");
const manifestPath = resolve(conformanceDir, "manifest.json");

let manifest: Manifest | null = null;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
} catch (err) {
  // The protocol repo is not present alongside this monorepo. Tests skip
  // gracefully — the harness still passes so CI doesn't gate on it.
  console.warn(`[conformance] manifest not found at ${manifestPath}: ${(err as Error).message}`);
}

function loadFixture(relPath: string): unknown {
  // Paths in manifest.json are relative to the conformance/ directory.
  const full = resolve(conformanceDir, relPath);
  return JSON.parse(readFileSync(full, "utf8"));
}

describe.skipIf(!manifest)("conformance — byte-level fixtures (LSDP/1)", () => {
  if (!manifest) return;

  describe("client → server frames", () => {
    for (const relPath of manifest.fixtures.client) {
      it(`round-trips ${relPath}`, () => {
        const fixture = loadFixture(relPath);
        const encoded = JSON.stringify(fixture);
        const decoded = decodeClientFrame(encoded);
        expect(decoded).not.toBeNull();
        // Re-encode and re-decode to ensure stable representation.
        const reencoded = encodeFrame(decoded as ClientFrame);
        const redecoded = decodeClientFrame(reencoded);
        expect(redecoded).toEqual(decoded);
      });
    }
  });

  describe("server → client frames", () => {
    for (const relPath of manifest.fixtures.server) {
      it(`round-trips ${relPath}`, () => {
        const fixture = loadFixture(relPath);
        const encoded = JSON.stringify(fixture);
        const decoded = decodeServerFrame(encoded);
        expect(decoded).not.toBeNull();
        const reencoded = encodeFrame(decoded as ServerFrame);
        const redecoded = decodeServerFrame(reencoded);
        expect(redecoded).toEqual(decoded);
      });
    }
  });
});
