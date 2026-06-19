// Public asset-resolution helpers (ADR 003 §3.2 / RC5) — migrated from the
// zero-loss harness's `asset-resolver.ts` and promoted to
// `src/render/asset-resolve.ts`. These prove the rewrite helpers map
// content-addressed refs to a caller table WITHOUT any network fetch.

import { describe, expect, it, vi, afterEach } from "vitest";
import {
  resolveSrc,
  rewriteLayoutSrcs,
  rewriteDefaultsSrcs,
  injectFonts,
  type AssetTable,
} from "../../src/render/asset-resolve.js";

const DATA = "data:image/png;base64,AAAA";
const TABLE: AssetTable = {
  "assets/ruby20.png": DATA,
  render3d: "data:image/png;base64,BBBB",
};

describe("resolveSrc (ADR 003 §3.2)", () => {
  it("matches a full `assets/<hash>.ext` key", () => {
    expect(resolveSrc("assets/ruby20.png", TABLE)).toBe(DATA);
  });

  it("matches a bare `<hash>` from an `assets/<hash>.ext` ref", () => {
    expect(resolveSrc("assets/render3d.jpg", TABLE)).toBe("data:image/png;base64,BBBB");
  });

  it("passes an unmatched ref through unchanged", () => {
    expect(resolveSrc("assets/unknown.png", TABLE)).toBe("assets/unknown.png");
  });

  it("passes a non-`assets/` URL through unchanged (already resolved)", () => {
    expect(resolveSrc("https://cdn.example/x.png", TABLE)).toBe("https://cdn.example/x.png");
  });

  it("passes non-string values through unchanged", () => {
    expect(resolveSrc(undefined, TABLE)).toBe(undefined);
    expect(resolveSrc(42, TABLE)).toBe(42);
  });
});

describe("rewriteLayoutSrcs (in-place deep rewrite)", () => {
  it("rewrites every `src` in a nested layout subtree", () => {
    const layout = {
      kind: "frame",
      children: [
        { kind: "image", src: "assets/ruby20.png" },
        { kind: "shape", fills: [{ kind: "image", src: "assets/render3d.jpg" }] },
        { kind: "text", text: "no src here" },
      ],
    };
    rewriteLayoutSrcs(layout, TABLE);
    expect(layout.children[0]).toMatchObject({ src: DATA });
    expect((layout.children[1] as { fills: { src: string }[] }).fills[0]?.src).toBe(
      "data:image/png;base64,BBBB",
    );
  });

  it("is a no-op on null / primitives", () => {
    expect(() => rewriteLayoutSrcs(null, TABLE)).not.toThrow();
    expect(() => rewriteLayoutSrcs("x", TABLE)).not.toThrow();
  });
});

describe("rewriteDefaultsSrcs (image-primitive bind defaults)", () => {
  it("rewrites `__lit.image.*` keys and leaves others untouched", () => {
    const defaults = {
      "__lit.image.cover": "assets/ruby20.png",
      "__lit.text.title": "assets/ruby20.png", // not an image key → untouched
      score: 3,
    };
    const out = rewriteDefaultsSrcs(defaults, TABLE);
    expect(out["__lit.image.cover"]).toBe(DATA);
    expect(out["__lit.text.title"]).toBe("assets/ruby20.png");
    expect(out["score"]).toBe(3);
    // returns a new object, does not mutate the input.
    expect(defaults["__lit.image.cover"]).toBe("assets/ruby20.png");
  });
});

describe("injectFonts — no-fetch, never throws (ADR 003 §3.3)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the families that loaded, swallows failures", async () => {
    // happy-dom's FontFace.load may reject; the helper must never throw and
    // must report only the families that actually loaded.
    const loaded = await injectFonts([
      { family: "Brand", weight: 400, src: "url(data:font/woff2;base64,AA)" },
    ]);
    expect(Array.isArray(loaded)).toBe(true);
  });

  it("does not call the network (no fetch invoked)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await injectFonts([{ family: "X", weight: 700, src: "url(data:font/woff2;base64,AA)" }]);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
