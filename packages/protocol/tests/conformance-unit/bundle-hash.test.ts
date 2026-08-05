import { describe, expect, it } from "vitest";
import { canonicalize, hashInlineBundle } from "../../src/conformance/index.js";

describe("canonicalize", () => {
  it("sorts object keys lexicographically at every nesting level", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
  });

  it("emits no insignificant whitespace", () => {
    expect(canonicalize({ a: [1, 2, { x: "hi" }] })).toBe('{"a":[1,2,{"x":"hi"}]}');
  });

  it("omits members with no JSON representation, like the wire form does", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalize({ a: 1, f: () => 0, s: Symbol("x") })).toBe('{"a":1}');
    expect(canonicalize({ o: { a: undefined, b: 1 } })).toBe('{"o":{"b":1}}');
    expect(canonicalize({ a: null })).toBe('{"a":null}');
  });

  it("still emits null for such values as array elements", () => {
    expect(canonicalize([1, undefined, 2])).toBe(JSON.stringify([1, undefined, 2]));
  });
});

describe("hashInlineBundle", () => {
  it("produces a sha256:<hex64> identity", async () => {
    const h = await hashInlineBundle({ lsml: "1.0", scene_id: "x" });
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is independent of key ordering", async () => {
    const a = await hashInlineBundle({ a: 1, b: 2 });
    const b = await hashInlineBundle({ b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it("changes when payload changes", async () => {
    const a = await hashInlineBundle({ a: 1 });
    const b = await hashInlineBundle({ a: 2 });
    expect(a).not.toBe(b);
  });

  it("hashes an undefined-valued member identically to an absent one", async () => {
    const a = await hashInlineBundle({ scene_id: "x", metadata: undefined });
    const b = await hashInlineBundle({ scene_id: "x" });
    expect(a).toBe(b);
  });

  it("zeros out scene_version before hashing (per LSML 1.0 §3)", async () => {
    const stub = await hashInlineBundle({ scene_id: "x" });
    const withZero = await hashInlineBundle({
      scene_id: "x",
      scene_version: "sha256:" + "0".repeat(64),
    });
    expect(stub).toBe(withZero);
  });
});
