import { describe, expect, it } from "vitest";
import { substitute } from "../../src/conformance/index.js";

const tokens = {
  $TOKEN_OPERATOR: "tok-op",
  $TOKEN_VIEWER: "tok-vw",
};
const bundles = {
  scoreboard: "sha256:" + "a".repeat(64),
};

describe("substitute", () => {
  it("replaces $TOKEN_* values", () => {
    expect(substitute("$TOKEN_OPERATOR", tokens, bundles)).toBe("tok-op");
  });

  it("leaves unknown $TOKEN_* placeholders verbatim", () => {
    expect(substitute("$TOKEN_INVALID", tokens, bundles)).toBe("$TOKEN_INVALID");
  });

  it("replaces $BUNDLE.<id>.hash", () => {
    expect(substitute("$BUNDLE.scoreboard.hash", tokens, bundles)).toBe(bundles["scoreboard"]);
  });

  it("leaves unknown bundle ids verbatim", () => {
    expect(substitute("$BUNDLE.unknown.hash", tokens, bundles)).toBe("$BUNDLE.unknown.hash");
  });

  it("recurses into objects", () => {
    expect(
      substitute(
        { token: "$TOKEN_VIEWER", inner: { v: "$BUNDLE.scoreboard.hash" } },
        tokens,
        bundles,
      ),
    ).toEqual({ token: "tok-vw", inner: { v: bundles["scoreboard"] } });
  });

  it("recurses into arrays", () => {
    expect(
      substitute(["$TOKEN_OPERATOR", "$TOKEN_VIEWER", { x: "$TOKEN_OPERATOR" }], tokens, bundles),
    ).toEqual(["tok-op", "tok-vw", { x: "tok-op" }]);
  });

  it("passes through non-string scalars", () => {
    expect(substitute(42, tokens, bundles)).toBe(42);
    expect(substitute(true, tokens, bundles)).toBe(true);
    expect(substitute(null, tokens, bundles)).toBe(null);
  });
});
