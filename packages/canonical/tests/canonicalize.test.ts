import { describe, expect, it } from "vitest";
import { bundleAddress, canonicalize, ZERO_HASH } from "../src/index.js";

// Pinned from lumencast-go/lsml/hash_xlang_golden_test.go — the Go SDK asserts
// its own output against these exact TS values. Moving them here is a
// cross-language break, not a local test failure.
//
// These are a regression pin, NOT an oracle: they are TS-derived, and ADR 005
// §3.2 rules that the authoritative `expected` comes from a third-party RFC 8785
// implementation, in the `bundle-address` corpus of lumencast-protocol (issue
// Lumencast/lumencast-protocol#42, not yet built). If the corpus ever disagrees
// with a value below, the corpus wins and these move.
// Bundles are parsed from their raw JSON rather than written as literals: that
// is how they reach the canonicalizer in production, and `case_a_float` carries
// an integer past 2^53 whose whole point is what the parse does to it.
const parseBundle = (raw: string) => JSON.parse(raw) as { scene_version: string };

const XLANG_GOLDENS = [
  {
    name: "case_a_float",
    bundle: parseBundle(
      `{"lsml":"1.1","scene_id":"s","scene_version":"${ZERO_HASH}","layout":{"kind":"stack"},"defaults":{"tiny":0.0000001,"exp":1.5e-10,"whole":2.0,"big":1234567890123456789}}`,
    ),
    canon:
      '{"defaults":{"big":1234567890123456800,"exp":1.5e-10,"tiny":1e-7,"whole":2},"layout":{"kind":"stack"},"lsml":"1.1","scene_id":"s","scene_version":"sha256:0000000000000000000000000000000000000000000000000000000000000000"}',
    hash: "16dee731508082b869796d77d45832e1d780866259ab48f5918e12c547c94662",
  },
  {
    name: "case_b_html",
    bundle: parseBundle(
      `{"lsml":"1.1","scene_id":"s","scene_version":"${ZERO_HASH}","layout":{"kind":"stack"},"metadata":{"title":"A & B <live>"}}`,
    ),
    canon:
      '{"layout":{"kind":"stack"},"lsml":"1.1","metadata":{"title":"A & B <live>"},"scene_id":"s","scene_version":"sha256:0000000000000000000000000000000000000000000000000000000000000000"}',
    hash: "7050dd0c6c1a92a174db87b457eb66205519cd87ac583694f97c8c3fb7da097c",
  },
  {
    name: "case_c_optional_absent",
    bundle: parseBundle(
      `{"lsml":"1.1","scene_id":"s","scene_version":"${ZERO_HASH}","layout":{"kind":"stack"}}`,
    ),
    canon:
      '{"layout":{"kind":"stack"},"lsml":"1.1","scene_id":"s","scene_version":"sha256:0000000000000000000000000000000000000000000000000000000000000000"}',
    hash: "f3f9db9b4436fe3ba31794e74d5c5959f94e90360c78d783adcd71989e2bd85c",
  },
];

describe("canonicalize — cross-language goldens", () => {
  for (const g of XLANG_GOLDENS) {
    it(`${g.name} canonicalizes byte-identically`, () => {
      expect(canonicalize(g.bundle)).toBe(g.canon);
    });

    it(`${g.name} hashes to the pinned identity`, async () => {
      expect(await bundleAddress(g.bundle)).toBe(`sha256:${g.hash}`);
    });
  }
});

describe("canonicalize — members with no JSON representation", () => {
  it("omits an explicitly-undefined key, matching an absent one", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });

  it("omits functions and symbols like JSON.stringify does", () => {
    expect(canonicalize({ a: 1, f: () => 0, s: Symbol("x") })).toBe('{"a":1}');
  });

  it("drops such members at every nesting level", () => {
    expect(canonicalize({ o: { a: 1, b: undefined }, arr: [{ c: undefined, d: 2 }] })).toBe(
      '{"arr":[{"d":2}],"o":{"a":1}}',
    );
  });

  it("keeps null distinct from undefined", () => {
    expect(canonicalize({ a: null })).toBe('{"a":null}');
    expect(canonicalize({ a: undefined })).toBe("{}");
  });

  it("still emits null for such values as array elements, like JSON.stringify", () => {
    expect(canonicalize([1, undefined, 2])).toBe("[1,null,2]");
    expect(canonicalize([1, undefined, 2])).toBe(JSON.stringify([1, undefined, 2]));
  });

  it("hashes an undefined-valued member identically to an absent one", async () => {
    const withUndefined = await bundleAddress({
      lsml: "1.1",
      scene_id: "s",
      scene_version: ZERO_HASH,
      layout: { kind: "stack" },
      metadata: undefined,
    });
    const withoutKey = await bundleAddress({
      lsml: "1.1",
      scene_id: "s",
      scene_version: ZERO_HASH,
      layout: { kind: "stack" },
    });
    expect(withUndefined).toBe(withoutKey);
    expect(withUndefined).toBe(`sha256:${XLANG_GOLDENS[2]!.hash}`);
  });
});

// ADR 005 §3.1 bis — "an implementation must hash what it serializes":
//   hash(x) == hash(JSON.parse(JSON.stringify(x)))
// This is the artefact that proves the fix, and no conformance vector can:
// a vector is loaded with JSON.parse, so it can never carry an `undefined`,
// a function, a symbol or a `toJSON` — the faulty canonicalizer and the correct
// one agree on every vector ever written (§3.1 bis).
//
// RC 2 bis requires it to be generic, not tailored to the known case: each
// entry below is a distinct way for an in-memory value to differ from its own
// serialization. Adding a case here is how the invariant grows.
describe("producer property (ADR 005 §3.1 bis, RC 2 + RC 2 bis)", () => {
  const cases: Record<string, unknown> = {
    "undefined member": { a: undefined, b: 1 },
    "function member": { a: () => 0, b: 1 },
    "symbol member": { a: Symbol("s"), b: 1 },
    "toJSON — Date": { d: new Date(0) },
    "toJSON — custom object": { c: { toJSON: () => ({ z: 1 }) } },
    "toJSON — returning undefined drops the member": { c: { toJSON: () => undefined }, b: 1 },
    "toJSON — nested inside an array": { a: [new Date(0), 1] },
    "undefined/function/symbol as array elements": { a: [undefined, () => 0, Symbol("s"), 1] },
    "nested mix": { o: { x: undefined, y: [1, { z: undefined, d: new Date(0) }] } },
    "plain JSON is unaffected": { a: null, b: 0, c: "", d: false, e: [1, 2] },
  };

  for (const [name, x] of Object.entries(cases)) {
    it(`canonicalizes the serialized form — ${name}`, () => {
      expect(canonicalize(x)).toBe(canonicalize(JSON.parse(JSON.stringify(x))));
    });

    it(`hashes the serialized form — ${name}`, async () => {
      const asBuilt = await bundleAddress(x);
      const asSent = await bundleAddress(JSON.parse(JSON.stringify(x)));
      expect(asBuilt).toBe(asSent);
    });
  }
});
