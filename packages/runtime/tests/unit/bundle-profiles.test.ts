import { describe, expect, it } from "vitest";
import { BundleIncompatibleError, validateBundleProfiles } from "../../src/render/bundle.js";

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
