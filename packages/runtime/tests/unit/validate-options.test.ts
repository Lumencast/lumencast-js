import { describe, expect, it } from "vitest";
import { validateOptions } from "../../src/internal/validate-options.js";
import type { MountOptions } from "../../src/types.js";

function baseOptions(overrides: Partial<MountOptions> = {}): MountOptions {
  const target = document.createElement("div");
  return {
    target,
    serverUrl: "ws://localhost/lsdp/v1",
    token: "t",
    mode: "broadcast",
    ...overrides,
  };
}

describe("validateOptions", () => {
  it("accepts broadcast mode without scene/session", () => {
    expect(() => validateOptions(baseOptions())).not.toThrow();
  });

  it("rejects non-HTMLElement target", () => {
    expect(() => validateOptions(baseOptions({ target: {} as unknown as HTMLElement }))).toThrow(
      /target/,
    );
  });

  it("rejects empty serverUrl", () => {
    expect(() => validateOptions(baseOptions({ serverUrl: "" }))).toThrow(/serverUrl/);
  });

  it("requires testSession + scene in test mode", () => {
    expect(() => validateOptions(baseOptions({ mode: "test" }))).toThrow(/testSession/);
    expect(() => validateOptions(baseOptions({ mode: "test", testSession: "s1" }))).toThrow(
      /scene/,
    );
    expect(() =>
      validateOptions(baseOptions({ mode: "test", testSession: "s1", scene: "main" })),
    ).not.toThrow();
  });
});
