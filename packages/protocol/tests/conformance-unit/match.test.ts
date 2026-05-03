import { describe, expect, it } from "vitest";
import { matchFrame, matchValue } from "../../src/conformance/index.js";

describe("matchValue — sentinels", () => {
  it("$ANY matches any present value", () => {
    expect(matchValue("$ANY", 42, "x")).toBeNull();
    expect(matchValue("$ANY", "hi", "x")).toBeNull();
    expect(matchValue("$ANY", null, "x")).toBeNull();
    expect(matchValue("$ANY", { a: 1 }, "x")).toBeNull();
  });

  it("$ANY_HASH matches sha256:<hex64> only", () => {
    const valid = "sha256:" + "a".repeat(64);
    expect(matchValue("$ANY_HASH", valid, "x")).toBeNull();
    expect(matchValue("$ANY_HASH", "not-a-hash", "x")).not.toBeNull();
    expect(matchValue("$ANY_HASH", "sha256:short", "x")).not.toBeNull();
    expect(matchValue("$ANY_HASH", 42, "x")).not.toBeNull();
  });
});

describe("matchFrame — structural", () => {
  it("matches identical objects", () => {
    expect(
      matchFrame({ v: 1, type: "snapshot", seq: 1 }, { v: 1, type: "snapshot", seq: 1 }),
    ).toBeNull();
  });

  it("tolerates extra fields in actual (forward-compat)", () => {
    expect(
      matchFrame(
        { v: 1, type: "delta" },
        { v: 1, type: "delta", ts: "2026-05-03T00:00:00Z", seq: 5 },
      ),
    ).toBeNull();
  });

  it("fails on missing field", () => {
    const err = matchFrame({ v: 1, type: "snapshot", seq: 1 }, { v: 1, type: "snapshot" });
    expect(err).toMatchObject({ path: "seq" });
  });

  it("fails on scalar mismatch", () => {
    const err = matchFrame({ v: 1 }, { v: 2 });
    expect(err?.path).toBe("v");
    expect(err?.reason).toMatch(/want 1.*got 2/);
  });

  it("recurses into nested objects", () => {
    expect(
      matchFrame(
        { state: { title: "Hello", count: 0 } },
        { state: { title: "Hello", count: 0, extra: 99 } },
      ),
    ).toBeNull();
  });

  it("matches arrays element-wise", () => {
    expect(
      matchFrame({ patches: [{ path: "x", value: 1 }] }, { patches: [{ path: "x", value: 1 }] }),
    ).toBeNull();
  });

  it("fails on array length mismatch", () => {
    const err = matchFrame(
      { patches: [{ path: "x", value: 1 }] },
      {
        patches: [
          { path: "x", value: 1 },
          { path: "y", value: 2 },
        ],
      },
    );
    expect(err?.reason).toMatch(/length 1 != 2/);
  });
});
