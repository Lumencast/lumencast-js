// Probe tests — bundle profiles edge cases (ADR 001 RC#1 / RC#14, LSML §17.3 / §17.5.1).
//
// Complements Forge's bundle-profiles.test.ts. This file covers the gaps:
//   - fragment (#frag) in profile identifier
//   - leading / trailing whitespace
//   - unicode / homoglyph in vendor segment
//   - empty string profile
//   - duplicate profiles
//   - authoring + behavioural from the same vendor
//   - profiles: null coercion (malformed JSON path)
//   - non-array profiles (malformed JSON — unsafe cast path)
//   - non-string entry in profiles array
//   - very long profiles array (DoS surface)
//   - RC#14 sentinelle: x-figma.authoring/1 alone passes all three paths
//     (validateBundleProfiles, preload(), get()) with identical verdict

import { describe, expect, it } from "vitest";
import {
  BundleIncompatibleError,
  createBundleFetcher,
  isAuthoringProfile,
  validateBundleProfiles,
  type RenderBundle,
} from "../../src/render/bundle.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GOOD_VERSION = "sha256:" + "a".repeat(64);

const bundleWith = (profiles: unknown): RenderBundle =>
  ({
    scene_version: GOOD_VERSION,
    root: { kind: "frame" },
    profiles,
  }) as unknown as RenderBundle;

const fetcherFor = (bundle: RenderBundle) =>
  createBundleFetcher({
    baseUrl: "http://example.test",
    fetchImpl: (() =>
      Promise.resolve(
        new Response(JSON.stringify(bundle), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )) as typeof fetch,
  });

// ---------------------------------------------------------------------------
// Fragment suffix — `x-figma.authoring/1#frag` is NOT an authoring profile
// ---------------------------------------------------------------------------

describe("fragment suffix in profile identifier", () => {
  it("isAuthoringProfile returns false for x-figma.authoring/1#frag", () => {
    expect(isAuthoringProfile("x-figma.authoring/1#frag")).toBe(false);
  });

  it("validateBundleProfiles hard-rejects a profile with a fragment suffix", () => {
    expect(() => validateBundleProfiles({ profiles: ["x-figma.authoring/1#frag"] })).toThrow(
      BundleIncompatibleError,
    );
  });

  // Symmetry: same verdict on get() and preload()
  it("preload() hard-rejects bundle with fragment-suffixed profile", () => {
    const fetcher = createBundleFetcher({ baseUrl: "http://example.test" });
    expect(() => fetcher.preload(bundleWith(["x-figma.authoring/1#frag"]))).toThrow(
      BundleIncompatibleError,
    );
  });

  it("get() hard-rejects bundle with fragment-suffixed profile", async () => {
    const bundle = bundleWith(["x-figma.authoring/1#frag"]);
    await expect(fetcherFor(bundle).get("scene", GOOD_VERSION)).rejects.toBeInstanceOf(
      BundleIncompatibleError,
    );
  });
});

// ---------------------------------------------------------------------------
// Whitespace — leading / trailing spaces must not be exempted
// ---------------------------------------------------------------------------

describe("whitespace in profile identifier", () => {
  it("isAuthoringProfile returns false for trailing space", () => {
    expect(isAuthoringProfile("x-figma.authoring/1 ")).toBe(false);
  });

  it("isAuthoringProfile returns false for leading space", () => {
    expect(isAuthoringProfile(" x-figma.authoring/1")).toBe(false);
  });

  it("validateBundleProfiles hard-rejects a profile with surrounding whitespace", () => {
    expect(() => validateBundleProfiles({ profiles: [" x-figma.authoring/1 "] })).toThrow(
      BundleIncompatibleError,
    );
  });

  // Symmetry: preload() same verdict
  it("preload() hard-rejects bundle with whitespace-padded profile", () => {
    const fetcher = createBundleFetcher({ baseUrl: "http://example.test" });
    expect(() => fetcher.preload(bundleWith([" x-figma.authoring/1 "]))).toThrow(
      BundleIncompatibleError,
    );
  });
});

// ---------------------------------------------------------------------------
// Unicode / homoglyphs in vendor segment — must not bypass [a-z0-9-] guard
// ---------------------------------------------------------------------------

describe("unicode and homoglyphs in vendor segment", () => {
  // Latin small letter dotless i (U+0131) — visually close to "i"
  it("isAuthoringProfile returns false for unicode homoglyph in vendor", () => {
    expect(isAuthoringProfile("x-fıgma.authoring/1")).toBe(false);
  });

  // Fullwidth hyphen (U+FF0D) instead of ASCII hyphen
  it("isAuthoringProfile returns false for fullwidth hyphen in vendor", () => {
    expect(isAuthoringProfile("x－figma.authoring/1")).toBe(false);
  });

  it("validateBundleProfiles hard-rejects unicode-vendor authoring lookalike", () => {
    expect(() => validateBundleProfiles({ profiles: ["x-fıgma.authoring/1"] })).toThrow(
      BundleIncompatibleError,
    );
  });

  // Symmetry: preload() same verdict
  it("preload() hard-rejects bundle with unicode-vendor authoring lookalike", () => {
    const fetcher = createBundleFetcher({ baseUrl: "http://example.test" });
    expect(() => fetcher.preload(bundleWith(["x-fıgma.authoring/1"]))).toThrow(
      BundleIncompatibleError,
    );
  });
});

// ---------------------------------------------------------------------------
// Empty string profile
// ---------------------------------------------------------------------------

describe("empty string profile", () => {
  it("isAuthoringProfile returns false for empty string", () => {
    expect(isAuthoringProfile("")).toBe(false);
  });

  it("validateBundleProfiles hard-rejects an empty-string profile", () => {
    expect(() => validateBundleProfiles({ profiles: [""] })).toThrow(BundleIncompatibleError);
    expect(() => validateBundleProfiles({ profiles: [""] })).toThrow(
      expect.objectContaining({ unsupportedProfiles: [""] }),
    );
  });
});

// ---------------------------------------------------------------------------
// Duplicate profiles
// ---------------------------------------------------------------------------

describe("duplicate profiles in the array", () => {
  it("duplicate authoring profiles are both advisory — no rejection", () => {
    expect(() =>
      validateBundleProfiles({
        profiles: ["x-figma.authoring/1", "x-figma.authoring/1"],
      }),
    ).not.toThrow();
  });

  it("duplicate unsupported behavioural profiles both appear in error.unsupportedProfiles", () => {
    try {
      validateBundleProfiles({ profiles: ["x-foo.bar-1.0", "x-foo.bar-1.0"] });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BundleIncompatibleError);
      expect((e as BundleIncompatibleError).unsupportedProfiles).toEqual([
        "x-foo.bar-1.0",
        "x-foo.bar-1.0",
      ]);
    }
  });
});

// ---------------------------------------------------------------------------
// Same vendor — authoring AND behavioural profile coexist
// ---------------------------------------------------------------------------

describe("authoring + behavioural profile from the same vendor", () => {
  it("authoring profile is skipped; unknown behavioural profile from same vendor is rejected", () => {
    try {
      validateBundleProfiles({
        profiles: ["x-figma.authoring/1", "x-figma.broadcast/1.0"],
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BundleIncompatibleError);
      expect((e as BundleIncompatibleError).unsupportedProfiles).toEqual(["x-figma.broadcast/1.0"]);
    }
  });

  // Symmetry: preload() and get() same verdict
  it("preload() rejects bundle with figma-vendor behavioural profile even when authoring is also listed", () => {
    const fetcher = createBundleFetcher({ baseUrl: "http://example.test" });
    expect(() =>
      fetcher.preload(bundleWith(["x-figma.authoring/1", "x-figma.broadcast/1.0"])),
    ).toThrow(BundleIncompatibleError);
  });

  it("get() rejects bundle with figma-vendor behavioural profile even when authoring is also listed", async () => {
    const bundle = bundleWith(["x-figma.authoring/1", "x-figma.broadcast/1.0"]);
    await expect(fetcherFor(bundle).get("scene", GOOD_VERSION)).rejects.toBeInstanceOf(
      BundleIncompatibleError,
    );
  });
});

// ---------------------------------------------------------------------------
// Malformed JSON path — profiles: null (falsy coercion)
// ---------------------------------------------------------------------------

describe("profiles: null coercion (malformed JSON from untrusted source)", () => {
  it("validateBundleProfiles treats null profiles as absent — no rejection", () => {
    // The guard `if (!profiles || profiles.length === 0) return;` treats null
    // as falsy. This is the current contract; the test pins it.
    expect(() => validateBundleProfiles(bundleWith(null))).not.toThrow();
  });

  it("preload() accepts a bundle with profiles: null (treated as no profiles)", () => {
    const fetcher = createBundleFetcher({ baseUrl: "http://example.test" });
    expect(() => fetcher.preload(bundleWith(null))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Malformed JSON path — profiles is a string, not an array
// ---------------------------------------------------------------------------

describe("non-array profiles (malformed JSON — unsafe cast path)", () => {
  // When the server returns `profiles: "x-figma.authoring/1"` instead of an
  // array, validateBundleProfiles receives a string through the unchecked
  // `json as RenderBundle` cast in FetcherImpl.get(). The rejection must be
  // TYPED (BundleIncompatibleError, code BUNDLE_INCOMPATIBLE) — never a raw
  // TypeError — and the diagnostic must not echo the malformed value.
  it("validateBundleProfiles with a string profiles value throws BundleIncompatibleError", () => {
    expect(() => validateBundleProfiles(bundleWith("x-figma.authoring/1"))).toThrow(
      BundleIncompatibleError,
    );
  });

  it("the diagnostic does not echo the malformed value", () => {
    try {
      validateBundleProfiles(bundleWith("x-figma.authoring/1"));
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BundleIncompatibleError);
      expect((e as BundleIncompatibleError).message).not.toContain("x-figma.authoring/1");
      expect((e as BundleIncompatibleError).unsupportedProfiles).not.toContain(
        "x-figma.authoring/1",
      );
    }
  });

  // Symmetry: preload() and get() same typed verdict
  it("preload() rejects a string-shaped profiles field with BundleIncompatibleError", () => {
    const fetcher = createBundleFetcher({ baseUrl: "http://example.test" });
    expect(() => fetcher.preload(bundleWith("x-figma.authoring/1"))).toThrow(
      BundleIncompatibleError,
    );
  });

  it("get() rejects a string-shaped profiles field with BundleIncompatibleError", async () => {
    const bundle = bundleWith("x-figma.authoring/1");
    await expect(fetcherFor(bundle).get("scene", GOOD_VERSION)).rejects.toBeInstanceOf(
      BundleIncompatibleError,
    );
  });
});

// ---------------------------------------------------------------------------
// Non-string entries in the profiles array
// ---------------------------------------------------------------------------

describe("non-string entries in profiles array (malformed JSON)", () => {
  // A non-string entry never reaches isAuthoringProfile (typeof guard runs
  // first) and is rejected as a typed BundleIncompatibleError. The
  // diagnostic carries a shape placeholder, never the raw value.
  it("validateBundleProfiles with [42] throws BundleIncompatibleError without echoing the value", () => {
    try {
      validateBundleProfiles(bundleWith([42]));
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BundleIncompatibleError);
      expect((e as BundleIncompatibleError).message).not.toContain("42");
      expect((e as BundleIncompatibleError).unsupportedProfiles).not.toContain(42);
    }
  });

  it("validateBundleProfiles with [null, 'x-figma.authoring/1'] throws BundleIncompatibleError", () => {
    // The advisory authoring entry stays advisory; only the malformed
    // entry causes the typed rejection.
    try {
      validateBundleProfiles(bundleWith([null, "x-figma.authoring/1"]));
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BundleIncompatibleError);
      expect((e as BundleIncompatibleError).unsupportedProfiles).toHaveLength(1);
      expect((e as BundleIncompatibleError).unsupportedProfiles).not.toContain(
        "x-figma.authoring/1",
      );
    }
  });

  // Symmetry: preload() and get() same typed verdict
  it("preload() rejects a bundle with a non-string profile entry with BundleIncompatibleError", () => {
    const fetcher = createBundleFetcher({ baseUrl: "http://example.test" });
    expect(() => fetcher.preload(bundleWith([42]))).toThrow(BundleIncompatibleError);
  });

  it("get() rejects a bundle with a non-string profile entry with BundleIncompatibleError", async () => {
    const bundle = bundleWith([42]);
    await expect(fetcherFor(bundle).get("scene", GOOD_VERSION)).rejects.toBeInstanceOf(
      BundleIncompatibleError,
    );
  });
});

// ---------------------------------------------------------------------------
// Very long profiles array (DoS surface)
// ---------------------------------------------------------------------------

describe("very long profiles array (DoS surface)", () => {
  it("1000 advisory authoring profiles all pass without rejection (linear time)", () => {
    const profiles = Array.from({ length: 1000 }, (_, i) => `x-vendor${i}.authoring/1`);
    expect(() => validateBundleProfiles({ profiles })).not.toThrow();
  });

  it("1000 unknown behavioural profiles all appear in unsupportedProfiles", () => {
    const profiles = Array.from({ length: 1000 }, (_, i) => `x-vendor${i}.unknown/1.0`);
    try {
      validateBundleProfiles({ profiles });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BundleIncompatibleError);
      expect((e as BundleIncompatibleError).unsupportedProfiles).toHaveLength(1000);
    }
  });
});

// ---------------------------------------------------------------------------
// RC#14 sentinelle — x-figma.authoring/1 alone, three-path symmetry
// ---------------------------------------------------------------------------

describe("RC#14 sentinelle: x-figma.authoring/1 alone passes all three paths with identical verdict", () => {
  const figmaOnlyBundle = bundleWith(["x-figma.authoring/1"]);

  it("validateBundleProfiles (direct validation path) — no rejection", () => {
    expect(() => validateBundleProfiles(figmaOnlyBundle)).not.toThrow();
  });

  it("preload() path — no rejection", () => {
    const fetcher = createBundleFetcher({ baseUrl: "http://example.test" });
    expect(() => fetcher.preload(figmaOnlyBundle)).not.toThrow();
  });

  it("get() path — resolves with the bundle intact", async () => {
    await expect(fetcherFor(figmaOnlyBundle).get("scene", GOOD_VERSION)).resolves.toMatchObject({
      profiles: ["x-figma.authoring/1"],
    });
  });
});
