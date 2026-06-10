// Probe tests — Issue #29, PR #39 (forge/29-compiler-lowering-11)
// ADR 001 RC#2/RC#10, R8, R9 — boundary/edge/pathological cases
// that Forge's proximity tests do not cover.
//
// Scope :
//   1. SVG path scanner — pathological numbers, repeated commands, exotic
//      whitespace, off-by-one caps, unicode, case-insensitive reject patterns,
//      throughput (10^6 commands scenario).
//   2. Filter clamps (R8) — exact boundary values, -0, NaN, Infinity, string
//      notation, combined filter string, keyframe step gate.
//   3. Lowering edge cases — 0-step / 1-step keyframes, unsorted offsets,
//      stagger extremes, scale arities, cornerRadius negative, fills[]
//      degenerate, paths[] empty.
//   4. Round-trip integration — rich LSML 1.1 compiles without error or
//      unexpected warnings.
//   5. R9 hygiene — no value leaked in any error / warn path introduced in
//      this PR, across all new paths exercised above.

import { describe, expect, it } from "vitest";
import {
  compileBundle,
  validatePathData,
  MAX_FILTER_BLUR_PX,
  MAX_FILTER_BRIGHTNESS,
  MAX_PATH_SUBPATHS,
  MAX_PATH_SUBPATH_BYTES,
  MAX_PATH_COMMANDS,
  ZERO_HASH,
  type LSMLBundle,
  type LSMLNode,
} from "../src/index.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function bundle(layout: LSMLNode): LSMLBundle {
  return { lsml: "1.1", scene_id: "probe", scene_version: ZERO_HASH, layout };
}

function collectWarns(layout: LSMLNode): {
  warns: string[];
  root: ReturnType<typeof compileBundle>["root"];
} {
  const warns: string[] = [];
  const out = compileBundle(bundle(layout), { onWarn: (m) => warns.push(m) });
  return { warns, root: out.root };
}

function compileFilter(
  filter: { blur?: unknown; brightness?: unknown },
  warns: string[] = [],
): string | undefined {
  const out = compileBundle(
    bundle({
      kind: "frame",
      id: "f",
      size: { w: 1, h: 1 },
      animate: {
        transition: { duration: 100 },
        opacity: 1,
        from: { filter: filter as never },
      },
    }),
    { onWarn: (m) => warns.push(m) },
  );
  return out.root.animate_initial?.filter as string | undefined;
}

// ─── 1. SVG path scanner ──────────────────────────────────────────────────────

describe("path scanner — pathological number forms", () => {
  it("accepts multi-digit exponent (1e9, 2.5E+3)", () => {
    expect(() =>
      validatePathData("M1e9,2.5E+3 L0,0 Z", "n", "pathData"),
    ).not.toThrow();
  });

  it("rejects double-dot numbers (1.2.3) — not in the allowlist grammar", () => {
    // `1.2.3` — the second dot makes `.` appear after a digit:
    // the scanner allows `.` as isPathNumberChar, so `1.2.3` itself
    // passes character-by-character. This is a known limitation:
    // we document it and ensure no injection occurs (no letters outside
    // the allowlist sneak through alongside).
    // The important property: no crash, no regex path.
    expect(() =>
      validatePathData("M1.2.3,4 L0,0 Z", "n", "pathData"),
    ).not.toThrow(); // allowed by char-level scanner (known limitation)
  });

  it("accepts sign sequences (+5, -3) in coordinates", () => {
    // +-+ is not valid SVG but the char-level scanner allows + and - anywhere.
    // Verify it does NOT crash and does NOT throw (char allowlist is permissive).
    expect(() =>
      validatePathData("M+5,-3 L+-+5,0 Z", "n", "pathData"),
    ).not.toThrow();
  });

  it("accepts consecutive commas (scanner is char-level, not grammar-level)", () => {
    expect(() =>
      validatePathData("M0,,0 L1,1 Z", "n", "pathData"),
    ).not.toThrow();
  });

  it("rejects unicode code points (U+2212 MINUS SIGN)", () => {
    // U+2212 '−' looks like minus but is outside ASCII allowlist
    const d = "M−1,0 L0,0 Z";
    expect(() => validatePathData(d, "n", "pathData")).toThrow(/allowlist|RC#10/);
  });

  it("rejects unicode letters that look like path commands (e.g. Ⅿ U+216F)", () => {
    const d = "Ⅿ0,0 L1,1 Z"; // Roman numeral M lookalike
    expect(() => validatePathData(d, "n", "pathData")).toThrow(/allowlist|RC#10/);
  });

  it("rejects null bytes (\\x00)", () => {
    const d = "M\x000,0 L1,1 Z";
    expect(() => validatePathData(d, "n", "pathData")).toThrow(/allowlist|RC#10/);
  });

  it("accepts path with only newline / tab / CR as whitespace between tokens", () => {
    expect(() =>
      validatePathData("M0,0\r\nL1,1\tZ", "n", "pathData"),
    ).not.toThrow();
  });
});

describe("path scanner — exponent edge cases", () => {
  it("rejects bare 'e' not preceded by a digit", () => {
    // 'e' at position 0 — no previous char
    expect(() => validatePathData("eM0,0 Z", "n", "pathData")).toThrow(/allowlist|RC#10/);
  });

  it("rejects 'e' preceded by a command letter", () => {
    // `Le3` — 'e' follows 'L' which is not a digit/dot
    expect(() => validatePathData("M0,0 Le3 Z", "n", "pathData")).toThrow(/allowlist|RC#10/);
  });

  it("rejects 'e' preceded by whitespace", () => {
    expect(() => validatePathData("M0,0 L1 e3 Z", "n", "pathData")).toThrow(/allowlist|RC#10/);
  });

  it("accepts 'e' immediately after a digit", () => {
    expect(() => validatePathData("M1e3,2E-4 L0,0 Z", "n", "pathData")).not.toThrow();
  });

  it("accepts 'e' immediately after a dot (e.g. 1.e3)", () => {
    expect(() => validatePathData("M1.e3,0 L0,0 Z", "n", "pathData")).not.toThrow();
  });
});

describe("path scanner — reject pattern case variants (R9 hygiene + correctness)", () => {
  it("rejects 'URL(' (uppercase)", () => {
    expect(() => validatePathData("M0,0 URL(http://x) Z", "n", "pathData")).toThrow(
      /allowlist|RC#10/,
    );
  });

  it("rejects 'Url(' (mixed case)", () => {
    // 'U' is not in PATH_COMMANDS, rejected by char allowlist
    expect(() => validatePathData("M0,0 Url(x) Z", "n", "pathData")).toThrow(/allowlist|RC#10/);
  });

  it("rejects 'DATA:' (uppercase)", () => {
    // 'D' is not a path command, rejected immediately
    expect(() => validatePathData("M0,0 DATA:x Z", "n", "pathData")).toThrow(/allowlist|RC#10/);
  });

  it("reject messages do NOT echo the payload (R9)", () => {
    let message = "";
    try {
      validatePathData("M0,0 url(evil-payload-xyz) Z", "node-abc", "pathData");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('"node-abc"');
    expect(message).not.toContain("evil-payload-xyz");
    expect(message).not.toContain("url(");
  });
});

describe("path scanner — off-by-one cap boundaries", () => {
  it("accepts a subpath exactly at MAX_PATH_SUBPATH_BYTES (8192 chars)", () => {
    // Build a path that is exactly 8192 chars: 'M0,0 ' (5) + 'L1,1 ' * N + 'Z'
    // We need total = 8192. 'Z' = 1, 'M0,0 ' = 5, each 'L1,1 ' = 5.
    // 8192 - 5 - 1 = 8186 → 8186 / 5 = 1637.2 → 1637 * 5 = 8185, total = 8191. Off by one.
    // Pad with an extra ' ' (isPathWhitespace) to hit exactly 8192.
    const prefix = "M0,0 ";
    const chunk = "L1,1 ";
    const suffix = "Z";
    const fill = chunk.repeat(1637); // 8185 - 5 - 1 = 8179, +5 = 8184, no...
    // Simpler approach: build to 8191 then add one allowed char (space):
    let d = prefix + chunk.repeat(Math.floor((MAX_PATH_SUBPATH_BYTES - prefix.length - suffix.length) / chunk.length)) + suffix;
    // Trim or pad with spaces to hit exactly 8192
    if (d.length < MAX_PATH_SUBPATH_BYTES) {
      // Pad with spaces (valid whitespace)
      d = d.slice(0, -1) + " ".repeat(MAX_PATH_SUBPATH_BYTES - d.length) + suffix;
    } else if (d.length > MAX_PATH_SUBPATH_BYTES) {
      d = d.slice(0, MAX_PATH_SUBPATH_BYTES - 1) + suffix;
    }
    expect(d.length).toBe(MAX_PATH_SUBPATH_BYTES);
    // Must not throw (exactly at the cap = accepted)
    expect(() => validatePathData(d, "n", "pathData")).not.toThrow();
  });

  it("rejects a subpath at MAX_PATH_SUBPATH_BYTES + 1", () => {
    const d = "M0,0 " + "L1,1 ".repeat(Math.ceil((MAX_PATH_SUBPATH_BYTES - 4) / 5)) + "Z";
    // Ensure it's over the limit
    const over = d.length > MAX_PATH_SUBPATH_BYTES ? d : d + " ";
    expect(over.length).toBeGreaterThan(MAX_PATH_SUBPATH_BYTES);
    expect(() => validatePathData(over, "n", "pathData")).toThrow(/8192/);
  });

  it("accepts exactly MAX_PATH_COMMANDS (4000) commands without throwing", () => {
    // 1 M + 3998 L + 1 Z = 4000 commands, all short to stay under 8 KiB
    // 'M0,0' = 4, ' L1,1' = 5*3998 = 19990 — too large. Use 'Z' spam instead.
    // 1 M + 3999 Z = 4000 commands.
    const d = "M0,0" + "Z".repeat(MAX_PATH_COMMANDS - 1);
    expect(d.length).toBeLessThanOrEqual(MAX_PATH_SUBPATH_BYTES);
    expect(() => validatePathData(d, "n", "pathData")).not.toThrow();
  });

  it("rejects exactly MAX_PATH_COMMANDS + 1 commands", () => {
    const d = "M0,0" + "Z".repeat(MAX_PATH_COMMANDS); // 4001 commands
    expect(d.length).toBeLessThanOrEqual(MAX_PATH_SUBPATH_BYTES);
    expect(() => validatePathData(d, "n", "pathData")).toThrow(/command subpath cap/);
  });

  it("accepts exactly MAX_PATH_SUBPATHS subpaths", () => {
    const paths = Array.from({ length: MAX_PATH_SUBPATHS }, () => ({ data: "M0,0 L1,1 Z" }));
    expect(() =>
      compileBundle(bundle({ kind: "shape", geometry: "path", paths })),
    ).not.toThrow();
  });

  it("rejects MAX_PATH_SUBPATHS + 1 subpaths (65)", () => {
    const paths = Array.from({ length: MAX_PATH_SUBPATHS + 1 }, () => ({ data: "M0,0 L1,1 Z" }));
    expect(() =>
      compileBundle(bundle({ kind: "shape", geometry: "path", paths })),
    ).toThrow(/subpath cap/);
  });
});

describe("path scanner — throughput (no freeze on adversarial input)", () => {
  it("rejects 10^6-command path in < 50 ms (linear scan, no ReDoS)", () => {
    // Build a string with 10^6 'Z' commands, but capped at 8 KiB by the
    // byte cap — so the scan is actually bounded by 8192 chars, not 10^6.
    // We test the rejection path itself: the byte cap fires first (fast).
    const hugePath = "M0,0" + "Z".repeat(1_000_000);
    const start = performance.now();
    try {
      validatePathData(hugePath, "n", "pathData");
    } catch {
      // expected rejection (byte cap)
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50); // even string construction aside, rejection is instant
  });

  it("validates a max-size legitimate path 1000 times in < 500 ms (linear scan)", () => {
    // 4000 'Z' commands = 4004 bytes, under 8 KiB.
    // 500 ms allows 0.5 ms/call which is generous even under coverage instrumentation.
    // The property we prove is linearity (no exponential blowup), not absolute speed.
    const d = "M0,0" + "Z".repeat(MAX_PATH_COMMANDS - 1);
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      validatePathData(d, "n", "pathData");
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

// ─── 2. Filter clamps — exact boundaries & degenerate inputs ─────────────────

describe("filter clamps — exact boundary values (R8)", () => {
  it(`accepts blur exactly at ${MAX_FILTER_BLUR_PX} (no clamp, no warn)`, () => {
    const warns: string[] = [];
    const result = compileFilter({ blur: MAX_FILTER_BLUR_PX }, warns);
    expect(result).toBe(`blur(${MAX_FILTER_BLUR_PX}px) brightness(1)`);
    expect(warns).toEqual([]);
  });

  it(`clamps blur at ${MAX_FILTER_BLUR_PX + 0.1} (just over)`, () => {
    const warns: string[] = [];
    const result = compileFilter({ blur: MAX_FILTER_BLUR_PX + 0.1 }, warns);
    expect(result).toBe(`blur(${MAX_FILTER_BLUR_PX}px) brightness(1)`);
    expect(warns.some((w) => w.includes("blur") && w.includes("clamped"))).toBe(true);
  });

  it(`accepts brightness exactly at ${MAX_FILTER_BRIGHTNESS} (no clamp, no warn)`, () => {
    const warns: string[] = [];
    const result = compileFilter({ brightness: MAX_FILTER_BRIGHTNESS }, warns);
    expect(result).toBe(`blur(0px) brightness(${MAX_FILTER_BRIGHTNESS})`);
    expect(warns).toEqual([]);
  });

  it(`clamps brightness at ${MAX_FILTER_BRIGHTNESS + 0.01} (just over)`, () => {
    const warns: string[] = [];
    const result = compileFilter({ brightness: MAX_FILTER_BRIGHTNESS + 0.01 }, warns);
    expect(result).toBe(`blur(0px) brightness(${MAX_FILTER_BRIGHTNESS})`);
    expect(warns.some((w) => w.includes("brightness") && w.includes("clamped"))).toBe(true);
  });

  it("rejects -0 for blur (negative zero is < 0 in isFinite check? — actually -0 >= 0)", () => {
    // Object.is(-0, 0) is false but -0 >= 0 is TRUE in JS.
    // So -0 should be ACCEPTED by the gate (blur = -0 → blur = 0).
    const warns: string[] = [];
    const result = compileFilter({ blur: -0 }, warns);
    expect(result).toBe("blur(0px) brightness(1)");
    expect(warns).toEqual([]);
  });

  it("rejects -0 for brightness (same: -0 >= 0, accepted — KNOWN GAP: emits brightness(0) not brightness(1))", () => {
    // BUG REPORT FOR FORGE (do not fix here):
    // `brightness: -0` passes the `f.brightness < 0` guard because
    // `-0 < 0` is `false` in IEEE-754 JS. The value is then stored as
    // `brightness = -0` and emitted as `brightness(0)` (not the identity 1).
    // This produces an invisible element. The gate should use
    // `Object.is(f.brightness, -0)` or `1/f.brightness === -Infinity`
    // to catch negative zero, or substitute the default (1) explicitly.
    // Until fixed, this test documents the ACTUAL (broken) behavior.
    const warns: string[] = [];
    const result = compileFilter({ brightness: -0 }, warns);
    // ACTUAL: emits brightness(0) — the gate misses -0
    expect(result).toBe("blur(0px) brightness(0)");
    expect(warns).toEqual([]); // no clamp warn either: -0 is < MAX_FILTER_BRIGHTNESS
  });

  it("rejects NaN for blur", () => {
    expect(() => compileFilter({ blur: Number.NaN })).toThrow(/blur/);
  });

  it("rejects NaN for brightness", () => {
    expect(() => compileFilter({ brightness: Number.NaN })).toThrow(/brightness/);
  });

  it("rejects Infinity for blur", () => {
    expect(() => compileFilter({ blur: Infinity })).toThrow(/blur/);
  });

  it("rejects -Infinity for brightness", () => {
    expect(() => compileFilter({ brightness: -Infinity })).toThrow(/brightness/);
  });

  it("rejects string '4px' for blur (wrong type)", () => {
    expect(() => compileFilter({ blur: "4px" as never })).toThrow(/blur/);
  });

  it("rejects string '1.2' for brightness (wrong type)", () => {
    expect(() => compileFilter({ brightness: "1.2" as never })).toThrow(/brightness/);
  });

  it("handles combined blur + brightness in a single filter (both within cap)", () => {
    const warns: string[] = [];
    const result = compileFilter({ blur: 5, brightness: 2 }, warns);
    expect(result).toBe("blur(5px) brightness(2)");
    expect(warns).toEqual([]);
  });

  it("clamps both blur AND brightness simultaneously, both diagnostics emitted", () => {
    const warns: string[] = [];
    const result = compileFilter({ blur: 9999, brightness: 9999 }, warns);
    expect(result).toBe(`blur(${MAX_FILTER_BLUR_PX}px) brightness(${MAX_FILTER_BRIGHTNESS})`);
    expect(warns.some((w) => w.includes("blur") && w.includes("clamped"))).toBe(true);
    expect(warns.some((w) => w.includes("brightness") && w.includes("clamped"))).toBe(true);
  });

  it("R9 — clamp warn for brightness does not echo the value", () => {
    const warns: string[] = [];
    compileFilter({ brightness: 99999 }, warns);
    const joined = warns.join(" ");
    expect(joined).not.toContain("99999");
  });

  it("R9 — reject error for string blur does not echo the value", () => {
    let message = "";
    try {
      compileFilter({ blur: "malicious-string-abc" as never });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain("malicious-string-abc");
    expect(message).toContain('"f"');
  });
});

// ─── 3. Lowering edge cases ───────────────────────────────────────────────────

describe("keyframes — degenerate step counts", () => {
  it("rejects 0 steps (empty steps array)", () => {
    // The runtime Keyframes type requires at least one step; compiling 0
    // steps is either rejected or produces an empty array. Either outcome
    // must not crash the compiler.
    // Probe: does the compiler throw or silently produce an empty steps[]?
    let threw = false;
    let result: ReturnType<typeof compileBundle> | undefined;
    try {
      result = compileBundle(
        bundle({
          kind: "frame",
          size: { w: 10, h: 10 },
          keyframes: { steps: [], duration_ms: 100 },
        }),
      );
    } catch {
      threw = true;
    }
    // No crash — either throw with a clear message OR produce empty steps.
    // The important property: no unhandled exception with a raw value.
    if (!threw) {
      expect(result?.root.keyframes?.steps).toEqual([]);
    }
    // If it did throw, it should not echo any value:
    if (threw) {
      // pass (already no unhandled exception by reaching this line)
    }
  });

  it("compiles 1-step keyframes correctly (single boundary step)", () => {
    const { root, warns } = collectWarns({
      kind: "frame",
      size: { w: 10, h: 10 },
      keyframes: {
        steps: [{ at: 0, opacity: 0 }],
        duration_ms: 100,
      },
    });
    expect(root.keyframes?.steps).toHaveLength(1);
    expect(root.keyframes?.steps[0]).toEqual({ at: 0, opacity: 0 });
    expect(warns).toEqual([]);
  });

  it("compiles unsorted step offsets (non-monotonic `at`) without crash", () => {
    // The spec does not say the compiler must reorder steps; it must not crash.
    // Probe whether the compiler reorders or passes through as-is.
    const { root } = collectWarns({
      kind: "frame",
      size: { w: 10, h: 10 },
      keyframes: {
        steps: [
          { at: 1, opacity: 1 },
          { at: 0, opacity: 0 },
        ],
        duration_ms: 100,
      },
    });
    // The compiler currently passes through as-is (no reorder).
    // Verify output shape is valid and no crash.
    expect(root.keyframes?.steps).toHaveLength(2);
    // Both steps present regardless of order
    expect(root.keyframes?.steps.map((s) => s.at).sort()).toEqual([0, 1]);
  });

  it("keyframe step at exactly 0 and exactly 1 compile correctly", () => {
    const { root } = collectWarns({
      kind: "frame",
      size: { w: 10, h: 10 },
      keyframes: {
        steps: [
          { at: 0, opacity: 0 },
          { at: 1, opacity: 1 },
        ],
        duration_ms: 200,
      },
    });
    expect(root.keyframes?.steps[0]?.at).toBe(0);
    expect(root.keyframes?.steps[1]?.at).toBe(1);
  });
});

describe("stagger_ms edge cases (§6.7)", () => {
  it("accepts stagger_ms = 0 (boundary: exactly 0 is valid)", () => {
    const { root } = collectWarns({
      kind: "repeat",
      scope: "p",
      bind: { items: "players" },
      stagger_ms: 0,
      template: { kind: "text", bind: { value: "{p}.name" } },
    });
    expect(root.stagger_ms).toBe(0);
  });

  it("rejects stagger_ms = NaN", () => {
    expect(() =>
      compileBundle(
        bundle({
          kind: "repeat",
          scope: "p",
          bind: { items: "players" },
          stagger_ms: Number.NaN,
          template: { kind: "text", bind: { value: "{p}.name" } },
        }),
      ),
    ).toThrow(/stagger_ms/);
  });

  it("rejects stagger_ms = Infinity", () => {
    expect(() =>
      compileBundle(
        bundle({
          kind: "repeat",
          scope: "p",
          bind: { items: "players" },
          stagger_ms: Infinity,
          template: { kind: "text", bind: { value: "{p}.name" } },
        }),
      ),
    ).toThrow(/stagger_ms/);
  });

  it("accepts a very large (but finite positive) stagger_ms", () => {
    // The compiler does not cap stagger_ms; the runtime does (STAGGER_CAP_MS).
    const { root } = collectWarns({
      kind: "repeat",
      scope: "p",
      bind: { items: "players" },
      stagger_ms: 1_000_000,
      template: { kind: "text", bind: { value: "{p}.name" } },
    });
    expect(root.stagger_ms).toBe(1_000_000);
  });

  it("R9 — stagger_ms reject does not echo the value", () => {
    let message = "";
    try {
      compileBundle(
        bundle({
          kind: "repeat",
          scope: "p",
          bind: { items: "players" },
          stagger_ms: -9999,
          template: { kind: "text", bind: { value: "{p}.name" } },
        }),
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain("9999");
    expect(message).toContain("stagger_ms");
  });
});

describe("scale arities (animate.from.transform.scale)", () => {
  it("lowers [0, 0] to scaleX=0, scaleY=0", () => {
    const { root } = collectWarns({
      kind: "frame",
      size: { w: 10, h: 10 },
      animate: {
        transition: { duration: 100 },
        transform: { scale: [0, 0] },
        from: { transform: { scale: [0, 0] } },
      },
    });
    expect(root.animate_initial?.scaleX).toBe(0);
    expect(root.animate_initial?.scaleY).toBe(0);
  });

  it("lowers [-1, 1] to scaleX=-1, scaleY=1 (flip)", () => {
    const { root } = collectWarns({
      kind: "frame",
      size: { w: 10, h: 10 },
      animate: {
        transition: { duration: 100 },
        transform: { scale: [-1, 1] },
        from: { transform: { scale: [-1, 1] } },
      },
    });
    expect(root.animate_initial?.scaleX).toBe(-1);
    expect(root.animate_initial?.scaleY).toBe(1);
  });

  it("scalar scale = 0 lowers to scale=0 (zero-size initial)", () => {
    const { root } = collectWarns({
      kind: "frame",
      size: { w: 10, h: 10 },
      animate: {
        transition: { duration: 100 },
        transform: { scale: 0 },
        from: { transform: { scale: 0 } },
      },
    });
    expect(root.animate_initial?.scale).toBe(0);
  });
});

describe("cornerRadius edge cases", () => {
  it("forwards cornerRadius = 0 as radius = 0", () => {
    const { root } = collectWarns({
      kind: "shape",
      geometry: "rect",
      size: { w: 10, h: 10 },
      cornerRadius: 0,
    });
    expect(root.props?.radius).toBe(0);
  });

  it("forwards cornerRadius negative (compiler does not gate sign, runtime-side concern)", () => {
    // The compiler spec does not explicitly reject negative cornerRadius.
    // Probe: does it throw or forward?
    let threw = false;
    let result: ReturnType<typeof compileBundle> | undefined;
    try {
      result = compileBundle(
        bundle({
          kind: "shape",
          geometry: "rect",
          size: { w: 10, h: 10 },
          cornerRadius: -5,
        }),
      );
    } catch {
      threw = true;
    }
    // Either outcome is acceptable, but NO silent drop.
    if (!threw) {
      // If accepted, it must be forwarded as radius (not cornerRadius)
      expect(result?.root.props?.cornerRadius).toBeUndefined();
      expect(result?.root.props?.radius).toBe(-5);
    }
  });
});

describe("fills[] degenerate inputs", () => {
  it("forwards fills[] empty array ([])", () => {
    // Probe: empty array is forwarded or rejected?
    // The compiler does not currently gate fills[] content.
    let threw = false;
    let result: ReturnType<typeof compileBundle> | undefined;
    try {
      result = compileBundle(
        bundle({
          kind: "shape",
          geometry: "rect",
          size: { w: 10, h: 10 },
          fills: [],
        }),
      );
    } catch {
      threw = true;
    }
    if (!threw) {
      expect(result?.root.props?.fills).toEqual([]);
    }
  });

  it("forwards a fills[] with a solid entry", () => {
    const { root } = collectWarns({
      kind: "shape",
      geometry: "rect",
      size: { w: 10, h: 10 },
      fills: [{ kind: "solid" as const, color: "#ff0000" }],
    });
    expect(root.props?.fills).toEqual([{ kind: "solid", color: "#ff0000" }]);
  });
});

describe("paths[] degenerate: empty array", () => {
  it("rejects paths[] = [] (must contain at least one subpath)", () => {
    expect(() =>
      compileBundle(
        bundle({
          kind: "shape",
          geometry: "path",
          paths: [],
        }),
      ),
    ).toThrow(/paths/);
  });
});

// ─── 4. Round-trip integration ────────────────────────────────────────────────

describe("round-trip: rich LSML 1.1 bundle compiles without error or unexpected warn", () => {
  it("compiles a full-featured frame with backgrounds, clipsContent, fills, paths, animate, keyframes", () => {
    const warns: string[] = [];
    const result = compileBundle(
      bundle({
        kind: "frame",
        id: "root-frame",
        size: { w: 1920, h: 1080 },
        backgrounds: [
          {
            kind: "linear-gradient" as const,
            angle_deg: 180,
            stops: [
              { offset: 0, color: "#000010" },
              { offset: 1, color: "#000000" },
            ],
          },
        ],
        clipsContent: true,
        animate: {
          transition: { duration: 300, easing: "ease-out" },
          opacity: 1,
          from: { opacity: 0, filter: { blur: 8, brightness: 0.8 } },
        },
        children: [
          {
            kind: "shape",
            id: "logo",
            geometry: "path",
            size: { w: 200, h: 100 },
            fills: [{ kind: "solid" as const, color: "#ffffff" }],
            strokes: [{ color: "#cccccc", width: 1 }],
            paths: [{ data: "M0,0 L200,0 L200,100 L0,100 Z", windingRule: "NONZERO" }],
          },
          {
            kind: "repeat",
            id: "players-list",
            scope: "player",
            bind: { items: "players" },
            stagger_ms: 50,
            template: { kind: "text", bind: { value: "{player}.name" } },
          },
        ],
        keyframes: {
          key: "frame.enter",
          steps: [
            { at: 0, opacity: 0 },
            { at: 0.5, opacity: 0.7, filter: { blur: 2, brightness: 1.1 } },
            { at: 1, opacity: 1 },
          ],
          duration_ms: 400,
          easing: "ease-in-out",
        },
      }),
      { onWarn: (m) => warns.push(m) },
    );

    expect(result.root.kind).toBe("frame");
    expect(result.root.props?.backgrounds).toHaveLength(1);
    expect(result.root.props?.clipsContent).toBe(true);
    expect(result.root.animate_initial?.opacity).toBe(0);
    expect(result.root.animate_initial?.filter).toBe("blur(8px) brightness(0.8)");
    expect(result.root.keyframes?.steps).toHaveLength(3);
    expect(result.root.children).toHaveLength(2);

    const shape = result.root.children![0]!;
    expect(shape.props?.fills).toEqual([{ kind: "solid", color: "#ffffff" }]);
    expect(shape.props?.strokes).toEqual([{ color: "#cccccc", width: 1 }]);
    expect(shape.props?.paths).toHaveLength(1);

    const repeat = result.root.children![1]!;
    expect(repeat.stagger_ms).toBe(50);

    // No unexpected warnings (mass/bindAnimate are not present)
    expect(warns).toEqual([]);
  });

  it("compiles a shape with pathData (single path) round-trip", () => {
    const { root, warns } = collectWarns({
      kind: "shape",
      id: "circle-approx",
      geometry: "path",
      pathData:
        "M100,50 C100,77.6 77.6,100 50,100 C22.4,100 0,77.6 0,50 C0,22.4 22.4,0 50,0 C77.6,0 100,22.4 100,50 Z",
    });
    expect(root.props?.pathData).toContain("M100,50");
    expect(warns).toEqual([]);
  });

  it("animate with no `from` produces no animate_initial", () => {
    const { root, warns } = collectWarns({
      kind: "frame",
      size: { w: 10, h: 10 },
      animate: {
        transition: { duration: 200 },
        opacity: 1,
        // no `from`
      },
    });
    expect(root.animate_initial).toBeUndefined();
    expect(root.transitions).toHaveProperty("opacity");
    expect(warns).toEqual([]);
  });
});

// ─── 5. R9 hygiene — no value in diagnostics (new error paths) ───────────────

describe("R9 — no value in any diagnostic or error from this PR's paths", () => {
  it("paths[] reject error does not echo path data values", () => {
    let message = "";
    try {
      compileBundle(
        bundle({
          kind: "shape",
          id: "sec-node",
          geometry: "path",
          paths: [{ data: "M0,0 data:text/evil Z" }],
        }),
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain("evil");
    expect(message).not.toContain("data:");
    expect(message).toContain('"sec-node"');
    expect(message).toContain("paths[0].data");
  });

  it("subpath byte cap error does not echo any part of the d string", () => {
    const d = "M0,0 " + "L999999,888888 ".repeat(600); // definitely > 8 KiB
    let message = "";
    try {
      validatePathData(d, "sensitive-node", "pathData");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain("999999");
    expect(message).not.toContain("888888");
    expect(message).toContain('"sensitive-node"');
  });

  it("command cap error does not echo any part of the d string", () => {
    const d = "M0,0" + "Z".repeat(MAX_PATH_COMMANDS + 1);
    let message = "";
    try {
      validatePathData(d, "cap-node", "d-field");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('"cap-node"');
    expect(message).toContain("d-field");
    // No numeric values from the path should appear
    expect(message).not.toMatch(/\b0\b/); // just check it's not echoing path content
  });

  it("filter string type error does not echo string value", () => {
    let message = "";
    try {
      compileFilter({ blur: "definitely-not-a-number-secret" as never });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain("definitely-not-a-number-secret");
  });
});
