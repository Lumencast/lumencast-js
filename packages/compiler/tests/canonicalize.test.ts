import { describe, expect, it } from "vitest";
import { canonicalize, hashBundle, ZERO_HASH } from "../src/canonicalize.js";

// Pinned from lumencast-go/lsml/hash_xlang_golden_test.go — the Go SDK asserts
// its own output against these exact TS values. Moving them here is a
// cross-language break, not a local test failure.
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
      const out = await hashBundle(g.bundle);
      expect(out.scene_version).toBe(`sha256:${g.hash}`);
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
    const withUndefined = await hashBundle({
      lsml: "1.1",
      scene_id: "s",
      scene_version: ZERO_HASH,
      layout: { kind: "stack" },
      metadata: undefined,
    });
    const withoutKey = await hashBundle({
      lsml: "1.1",
      scene_id: "s",
      scene_version: ZERO_HASH,
      layout: { kind: "stack" },
    });
    expect(withUndefined.scene_version).toBe(withoutKey.scene_version);
    expect(withUndefined.scene_version).toBe(`sha256:${XLANG_GOLDENS[2]!.hash}`);
  });
});

describe("canonicalize — agrees with the shape that goes on the wire", () => {
  const samples: unknown[] = [
    { a: 1, b: undefined },
    { nested: { x: undefined, y: [1, { z: undefined }] } },
    { a: null, b: 0, c: "", d: false },
    { arr: [undefined, null, 1] },
  ];

  it("matches JSON.parse(JSON.stringify(v)) canonicalized", () => {
    for (const s of samples) {
      expect(canonicalize(s)).toBe(canonicalize(JSON.parse(JSON.stringify(s))));
    }
  });
});
