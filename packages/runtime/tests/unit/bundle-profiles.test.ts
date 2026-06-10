import { describe, expect, it } from "vitest";
import {
  BundleIncompatibleError,
  createBundleFetcher,
  isAuthoringProfile,
  validateBundleProfiles,
  type RenderBundle,
} from "../../src/render/bundle.js";

describe("LSML 1.1 §17.3 — profiles[] gating", () => {
  it("accepts a bundle with no profiles[] declared", () => {
    expect(() => validateBundleProfiles({})).not.toThrow();
    expect(() => validateBundleProfiles({ profiles: [] })).not.toThrow();
  });

  it("accepts a bundle whose profiles are all in the supported set", () => {
    expect(() =>
      validateBundleProfiles({ profiles: ["x-lumencast.color-srgb-1.0"] }),
    ).not.toThrow();
  });

  it("throws BundleIncompatibleError when an unsupported profile is declared", () => {
    expect(() => validateBundleProfiles({ profiles: ["x-lumencast.color-oklch-1.0"] })).toThrow(
      BundleIncompatibleError,
    );
  });

  it("error lists every unsupported profile", () => {
    try {
      validateBundleProfiles({
        profiles: [
          "x-lumencast.color-srgb-1.0",
          "x-vendor.unknown-1.0",
          "x-vendor.also-missing-2.0",
        ],
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BundleIncompatibleError);
      const err = e as BundleIncompatibleError;
      expect(err.code).toBe("BUNDLE_INCOMPATIBLE");
      expect(err.unsupportedProfiles).toEqual([
        "x-vendor.unknown-1.0",
        "x-vendor.also-missing-2.0",
      ]);
    }
  });
});

describe("LSML 1.1 §17.5.1 — authoring profiles are advisory (ADR 001 RC#1)", () => {
  it("ignores x-figma.authoring/1 without rejection", () => {
    expect(() => validateBundleProfiles({ profiles: ["x-figma.authoring/1"] })).not.toThrow();
  });

  it("ignores any authoring vendor, even an unknown one (x-evil.authoring/1, RC#14)", () => {
    expect(() => validateBundleProfiles({ profiles: ["x-evil.authoring/1"] })).not.toThrow();
  });

  it("accepts authoring profiles mixed with supported behavioural profiles", () => {
    expect(() =>
      validateBundleProfiles({
        profiles: ["x-lumencast.color-srgb-1.0", "x-figma.authoring/1"],
      }),
    ).not.toThrow();
  });

  it("still hard-rejects an unsupported behavioural profile next to an authoring one", () => {
    try {
      validateBundleProfiles({
        profiles: ["x-figma.authoring/1", "x-acme.broadcast/1.0"],
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BundleIncompatibleError);
      // The advisory authoring profile is never listed as offending.
      expect((e as BundleIncompatibleError).unsupportedProfiles).toEqual(["x-acme.broadcast/1.0"]);
    }
  });

  it("still hard-rejects unknown dash-form profiles (RC#1 second clause)", () => {
    expect(() => validateBundleProfiles({ profiles: ["x-foo.bar-1.0"] })).toThrow(
      BundleIncompatibleError,
    );
  });
});

describe("ADR 001 RC#14 — authoring detection is full-form, never substring", () => {
  it("matches the complete x-<vendor>.authoring/<major> form", () => {
    expect(isAuthoringProfile("x-figma.authoring/1")).toBe(true);
    expect(isAuthoringProfile("x-evil.authoring/1")).toBe(true);
    expect(isAuthoringProfile("x-acme.sub-tool.authoring/12")).toBe(true);
  });

  it("rejects .authoring in a NON-terminal position (evasion attempt)", () => {
    // Behavioural profile whose name merely contains `.authoring.` — NOT
    // exempted, keeps §17.3.1 hard rejection.
    expect(isAuthoringProfile("x-evil.authoring.fx/1")).toBe(false);
    expect(() => validateBundleProfiles({ profiles: ["x-evil.authoring.fx/1"] })).toThrow(
      BundleIncompatibleError,
    );
  });

  it("rejects 'authoring' as a substring of another segment (evasion attempt)", () => {
    expect(isAuthoringProfile("x-evilauthoring/1")).toBe(false);
    expect(isAuthoringProfile("x-evil.notauthoring/1")).toBe(false);
    expect(isAuthoringProfile("x-evil.authoringx/1")).toBe(false);
    expect(() => validateBundleProfiles({ profiles: ["x-evilauthoring/1"] })).toThrow(
      BundleIncompatibleError,
    );
  });

  it("rejects malformed variants of the authoring form", () => {
    // Missing x- prefix.
    expect(isAuthoringProfile("evil.authoring/1")).toBe(false);
    // Bare ".authoring" with no vendor.
    expect(isAuthoringProfile("x-.authoring/1")).toBe(false);
    expect(isAuthoringProfile(".authoring/1")).toBe(false);
    // No version separator at all (dash-form is behavioural).
    expect(isAuthoringProfile("x-evil.authoring-1.0")).toBe(false);
    expect(isAuthoringProfile("x-evil.authoring")).toBe(false);
    // Non-<major> versions: §17.5 declares `/<major>` only.
    expect(isAuthoringProfile("x-evil.authoring/1.0")).toBe(false);
    expect(isAuthoringProfile("x-evil.authoring/")).toBe(false);
    expect(isAuthoringProfile("x-evil.authoring/v1")).toBe(false);
    expect(isAuthoringProfile("x-evil.authoring/01")).toBe(false);
    // Extra slash segments.
    expect(isAuthoringProfile("x-evil.authoring/1/2")).toBe(false);
    // Uppercase is not the profile identifier convention — not exempted.
    expect(isAuthoringProfile("x-Evil.AUTHORING/1")).toBe(false);
  });
});

describe("fetch + preload paths apply the same gating (ADR 001 RC#1)", () => {
  const bundleWith = (profiles: string[]): RenderBundle => ({
    scene_version: "sha256:" + "a".repeat(64),
    root: { kind: "frame" },
    profiles,
  });

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

  it("get() resolves a bundle declaring an authoring profile", async () => {
    const bundle = bundleWith(["x-figma.authoring/1"]);
    await expect(fetcherFor(bundle).get("scene", bundle.scene_version)).resolves.toEqual(bundle);
  });

  it("get() rejects a bundle declaring an unsupported behavioural profile", async () => {
    const bundle = bundleWith(["x-foo.bar-1.0"]);
    await expect(fetcherFor(bundle).get("scene", bundle.scene_version)).rejects.toBeInstanceOf(
      BundleIncompatibleError,
    );
  });

  it("preload() accepts authoring profiles and rejects behavioural unknowns", () => {
    const fetcher = createBundleFetcher({ baseUrl: "http://example.test" });
    expect(() => fetcher.preload(bundleWith(["x-evil.authoring/1"]))).not.toThrow();
    expect(() => fetcher.preload(bundleWith(["x-acme.broadcast/1.0"]))).toThrow(
      BundleIncompatibleError,
    );
  });
});
