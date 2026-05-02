import { describe, expect, it } from "vitest";
import { LumencastError, isProtocolErrorCode } from "../src/index.js";

describe("isProtocolErrorCode", () => {
  it("accepts every code in the closed taxonomy", () => {
    for (const c of [
      "AUTH_DENIED",
      "WRITE_FORBIDDEN",
      "SCENE_NOT_FOUND",
      "BUNDLE_FETCH_FAILED",
      "BUNDLE_INCOMPATIBLE",
      "VERSION_GAP",
      "VERSION_MISMATCH",
      "UNKNOWN_PATH",
      "INVALID_VALUE",
      "RATE_LIMIT",
      "TEST_SESSION_EXPIRED",
      "INTERNAL",
    ]) {
      expect(isProtocolErrorCode(c)).toBe(true);
    }
  });

  it("rejects unknown codes", () => {
    expect(isProtocolErrorCode("MADE_UP")).toBe(false);
    expect(isProtocolErrorCode(undefined)).toBe(false);
    expect(isProtocolErrorCode(123)).toBe(false);
  });
});

describe("LumencastError", () => {
  it("stores code, message, recoverable, optional retry_after_ms", () => {
    const e = new LumencastError({
      code: "RATE_LIMIT",
      message: "slow down",
      recoverable: true,
      retry_after_ms: 100,
    });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("LumencastError");
    expect(e.code).toBe("RATE_LIMIT");
    expect(e.message).toBe("slow down");
    expect(e.recoverable).toBe(true);
    expect(e.retry_after_ms).toBe(100);
  });
});
