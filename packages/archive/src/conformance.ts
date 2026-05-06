// LSMLZ/1 conformance runner.
//
// Loads case files matching the format documented in
// lumencast-protocol/conformance/lsmlz/README.md and runs them against
// the package's pack / unpack / isArchive APIs.
//
// Cases describe ZIP byte-input + the expected reader output (or
// rejection code). The runner :
//
//   1. Synthesises the input bytes from `entries` (map of path → content
//      with string / hex / base64 variants), or from a top-level `hex` /
//      `ascii` / `base64` blob.
//   2. Calls the relevant API (`isArchive` for magic-byte cases,
//      `unpackArchive` for everything else).
//   3. Compares the result (or thrown error code) to the case's `expect`
//      block.
//
// Exposed for any LSMLZ reader implementation to drive against the
// vendor-neutral case set.

import { strToU8, zipSync } from "fflate";
import { isArchive, LSMLZError, unpackArchive } from "./archive.js";

export interface CaseInput {
  /** Map of archive entry path → content (either a UTF-8 string, a base64
   *  encoded blob, or a hex string). The runner builds a ZIP from these
   *  entries before feeding the bytes to `unpackArchive`. */
  entries?: Record<string, string | { base64?: string; hex?: string }>;
  /** Raw bytes as a hex string (`""` for empty input). Used for
   *  magic-byte cases where the input isn't a valid ZIP. */
  hex?: string;
  /** Raw bytes from an ASCII / UTF-8 string. Used for "is this archive
   *  or JSON ?" sniff cases. */
  ascii?: string;
  /** Raw bytes from a base64 string. */
  base64?: string;
}

export interface CaseExpect {
  /** Set on invalid cases — the runner asserts unpackArchive throws
   *  LSMLZError, and `code` matches when present. */
  reject?: boolean;
  code?: string;
  /** Set on valid cases — asserted against `unpackArchive(...)` result. */
  bundle_filename?: string;
  asset_paths?: string[];
  /** Set on magic-byte cases — asserted against `isArchive(...)`. */
  is_archive?: boolean;
  /** Free-form comment, ignored by the runner. */
  reason?: string;
}

export interface SingleCase {
  input: CaseInput;
  expect: CaseExpect;
}

export interface CaseFile {
  name: string;
  description?: string;
  tag?: "required" | "recommended" | "extended";
  spec_refs?: string[];
  /** Single-case form. */
  input?: CaseInput;
  expect?: CaseExpect;
  /** Multi-case form — each entry is a sub-case with its own input + expect. */
  cases?: SingleCase[];
}

export interface CaseResult {
  /** Case name (or `<file>.cases[i]` for sub-cases). */
  name: string;
  pass: boolean;
  /** Failure reason when pass = false. */
  reason?: string;
}

/** Decode a hex string into bytes. `""` → empty. */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length === 0) return new Uint8Array();
  if (hex.length % 2 !== 0) {
    throw new Error(`hex string has odd length : ${JSON.stringify(hex)}`);
  }
  const matches = hex.match(/.{2}/g);
  if (matches === null) return new Uint8Array();
  return Uint8Array.from(matches.map((b) => parseInt(b, 16)));
}

/** Decode a base64 string into bytes. Uses Node's Buffer when available
 *  (covers Node + jsdom-like environments), falls back to atob in a
 *  browser. */
function base64ToBytes(b64: string): Uint8Array {
  const NodeBuffer = (globalThis as unknown as { Buffer?: typeof Buffer }).Buffer;
  if (NodeBuffer !== undefined) {
    return Uint8Array.from(NodeBuffer.from(b64, "base64"));
  }
  const decoded = atob(b64);
  const out = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
  return out;
}

/** Normalise a `CaseInput` to a `Uint8Array`. */
function inputToBytes(input: CaseInput): Uint8Array {
  if (input.hex !== undefined) return hexToBytes(input.hex);
  if (input.ascii !== undefined) return strToU8(input.ascii);
  if (input.base64 !== undefined) return base64ToBytes(input.base64);
  if (input.entries !== undefined) {
    const zipped: Record<string, Uint8Array> = {};
    for (const [path, content] of Object.entries(input.entries)) {
      if (typeof content === "string") {
        zipped[path] = strToU8(content);
      } else if (content.base64 !== undefined) {
        zipped[path] = base64ToBytes(content.base64);
      } else if (content.hex !== undefined) {
        zipped[path] = hexToBytes(content.hex);
      } else {
        zipped[path] = new Uint8Array();
      }
    }
    return zipSync(zipped, { level: 6 });
  }
  throw new Error("CaseInput has no recognised variant (entries / hex / ascii / base64)");
}

/** Run a single case (input + expect) and return the result. Doesn't throw
 *  on assertion failures — returns `pass: false` with a reason string,
 *  so callers (a Vitest test, a CI runner, an HTTP harness) can choose
 *  how to surface the failure. */
export function runCase(name: string, single: SingleCase): CaseResult {
  let bytes: Uint8Array;
  try {
    bytes = inputToBytes(single.input);
  } catch (err) {
    return {
      name,
      pass: false,
      reason: `failed to decode case input : ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Magic-byte sniff cases — exercise isArchive.
  if (single.expect.is_archive !== undefined) {
    const got = isArchive(bytes);
    if (got !== single.expect.is_archive) {
      return {
        name,
        pass: false,
        reason: `isArchive : expected ${single.expect.is_archive}, got ${got}`,
      };
    }
    return { name, pass: true };
  }

  // Rejection cases — unpackArchive must throw LSMLZError, optionally
  // with the specified code.
  if (single.expect.reject === true) {
    try {
      unpackArchive(bytes);
      return {
        name,
        pass: false,
        reason: `expected rejection${single.expect.code ? ` with code ${single.expect.code}` : ""}, but unpackArchive succeeded`,
      };
    } catch (err) {
      if (!(err instanceof LSMLZError)) {
        return {
          name,
          pass: false,
          reason: `expected LSMLZError, got ${err instanceof Error ? err.constructor.name : typeof err}`,
        };
      }
      if (single.expect.code !== undefined && err.code !== single.expect.code) {
        return {
          name,
          pass: false,
          reason: `expected code ${single.expect.code}, got ${err.code}`,
        };
      }
      return { name, pass: true };
    }
  }

  // Valid cases — unpackArchive succeeds and the result matches the
  // expected bundle filename + asset paths.
  let result: ReturnType<typeof unpackArchive>;
  try {
    result = unpackArchive(bytes);
  } catch (err) {
    return {
      name,
      pass: false,
      reason: `unpackArchive threw unexpectedly : ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (
    single.expect.bundle_filename !== undefined &&
    result.bundlePath !== single.expect.bundle_filename
  ) {
    return {
      name,
      pass: false,
      reason: `bundlePath : expected ${single.expect.bundle_filename}, got ${result.bundlePath}`,
    };
  }
  if (single.expect.asset_paths !== undefined) {
    const got = [...result.assets.map((a) => a.path)].sort();
    const want = [...single.expect.asset_paths].sort();
    if (got.length !== want.length || got.some((p, i) => p !== want[i])) {
      return {
        name,
        pass: false,
        reason: `asset_paths : expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
      };
    }
  }

  return { name, pass: true };
}

/** Run every sub-case in a `CaseFile` (whether the file uses the
 *  single-case shape or the multi-case `cases:` array). Returns an array
 *  of per-sub-case results. */
export function runCaseFile(caseFile: CaseFile): CaseResult[] {
  if (caseFile.cases !== undefined && caseFile.cases.length > 0) {
    return caseFile.cases.map((sub, i) => runCase(`${caseFile.name}#${i}`, sub));
  }
  if (caseFile.input !== undefined && caseFile.expect !== undefined) {
    return [runCase(caseFile.name, { input: caseFile.input, expect: caseFile.expect })];
  }
  return [
    {
      name: caseFile.name,
      pass: false,
      reason: "case file has neither `input + expect` nor `cases:` array",
    },
  ];
}
