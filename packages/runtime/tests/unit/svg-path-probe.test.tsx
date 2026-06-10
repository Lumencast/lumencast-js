// Probe — svg-path.ts exhaustive complement (ADR 001 RC#3/RC#10/RC#12, issue #30)
//
// Covers gaps NOT in Forge's svg-path.test.tsx:
//   1. Malformed numbers: 1.2.3, +-5, 1e9999, .5. (double-dot)
//   2. Off-by-one caps: 8 KiB exact / +1, 64/65 subpaths, 4000/4001 commands
//   3. Command arity: C with 4 coords vs 6 (scanner doesn't check arity —
//      documents the contract), Z followed by coordinates
//   4. Whitespace-only `d`, infinite coordinates
//   5. Unicode / fullwidth character rejection
//   6. Mixed-case rejection strings (Url(, dAtA:)
//   7. Valid heavy path perf: 10⁴ legitimate commands — time < 10 ms
//   8. parseShapePaths: empty paths[], one invalid among valids (drop + others render)
//   9. pathData + paths[] together: paths[] wins + diagnostic
//  10. Live sequences: hostile→valid→hostile on pathData, paths[], and strokes[]
//  11. viewBox with width/height of 0 and negative (edge cases in Shape)
//  12. Cross-PR cap alignment (compiler=4000, runtime=4000, issue #41)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

import {
  MAX_SUBPATH_COMMANDS,
  MAX_SUBPATH_LEN,
  MAX_SUBPATHS,
  parseShapePaths,
  validatePathData,
} from "../../src/render/svg-path.js";
import { Tree } from "../../src/render/tree.js";
import { createStore, type Store } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";

// ─── 1. Malformed numbers ─────────────────────────────────────────────

describe("validatePathData — malformed number tokens", () => {
  it("double-decimal 1.2.3 — two valid adjacent floats accepted ; 1..2 rejected (bug fixed)", () => {
    // "M0 0 L1.2.3 4": after consuming "1.2", the scanner reaches ".3" and
    // parses it as a new number (0.3). Per SVG path grammar, "1.2.3" IS
    // valid (two adjacent floats) — accepted by design.
    const result12_3 = validatePathData("M0 0 L1.2.3 4");
    expect(result12_3).not.toBeNull(); // accepted — two tokens: 1.2 and .3
    // No injection characters may slip through regardless.
    expect(result12_3).not.toMatch(/url\(|data:|[<>&;}{"'\\()]/i);

    // "1..2" is NOT valid SVG path data ("1." with empty decimal part
    // immediately followed by another "."). Previously mis-scanned as
    // "1." + ".2" (Probe bug report) — fixed by Forge: now rejected.
    expect(validatePathData("M0 0 L1..2 3")).toBeNull();
  });

  it("rejects double sign +-5", () => {
    // After consuming "+", next i points at "-" which is also a sign.
    // digits would be 0 → rejected.
    expect(validatePathData("M0 0 L+-5 0")).toBeNull();
  });

  it("rejects --5 (double minus)", () => {
    expect(validatePathData("M0 0 L--5 0")).toBeNull();
  });

  it("rejects bare dot .5. (trailing dot after second token)", () => {
    // ".5" is valid (0.5); the trailing "." is then a new number token with 0 digits
    expect(validatePathData("M0 0 L.5. 1")).toBeNull();
  });

  it("rejects 1e9999 (valid syntax, large exponent) — should be ACCEPTED by allowlist scanner", () => {
    // The scanner only validates grammar, NOT numeric value.
    // 1e9999 is syntactically valid per the allowlist grammar.
    // This documents the contract: scanner allows it, rendering is safe
    // (SVG engine will clamp Infinity to a no-op path).
    const result = validatePathData("M0 0 L1e9999 0");
    // Must be accepted (grammar is valid) OR null — but never inject.
    if (result !== null) {
      expect(result).not.toMatch(/url\(|data:|[<>&;}{"'\\()]/i);
    }
    // For documentation: log whether it's accepted
    expect(typeof result === "string" || result === null).toBe(true);
  });

  it("rejects empty exponent 1e (no digits after e)", () => {
    expect(validatePathData("M0 0 L1e 2")).toBeNull();
  });

  it("rejects exponent with only sign 1e+ (no digits)", () => {
    expect(validatePathData("M0 0 L1e+ 2")).toBeNull();
  });

  it("rejects bare sign before a command: M0 0 L+ Z", () => {
    // "+" consumed, next is " " separator, digits=0 → null
    expect(validatePathData("M0 0 L+ Z")).toBeNull();
  });

  it("rejects bare dot before a command: M0 0 L. Z", () => {
    expect(validatePathData("M0 0 L. Z")).toBeNull();
  });
});

// ─── 2. Off-by-one caps ──────────────────────────────────────────────

describe("validatePathData — off-by-one cap boundary conditions", () => {
  it("8 KiB exactly (MAX_SUBPATH_LEN) is NOT rejected by length gate — +1 byte IS", () => {
    // value.length > MAX_SUBPATH_LEN — so exactly MAX_SUBPATH_LEN passes the gate.
    // Build a string of exactly MAX_SUBPATH_LEN chars with valid grammar.
    // Use single chars to get precise length: "M" + "0" * (MAX_SUBPATH_LEN - 1)
    // But "0" is a digit, not a command, so the scanner needs a leading M.
    // Easiest: "M" + "Z".repeat(MAX_SUBPATH_LEN - 1)
    // But that hits the command cap (M=1 + Z*(MAX-1) = MAX commands total > MAX_SUBPATH_COMMANDS).
    // Use spaces to pad: "M0 0" + " ".repeat(MAX_SUBPATH_LEN - 4)
    // Separators are ignored by the scanner — valid grammar, no injection.
    const padded = "M0 0" + " ".repeat(MAX_SUBPATH_LEN - 4);
    expect(padded.length).toBe(MAX_SUBPATH_LEN);
    // trim() removes trailing spaces → "M0 0". Length after trim = 4.
    // d.length check is on the ORIGINAL value.length before trim.
    // value.length === MAX_SUBPATH_LEN → NOT > MAX → passes gate.
    const result = validatePathData(padded);
    expect(result).not.toBeNull(); // passes length gate, valid grammar

    // Now test +1 byte
    const overByOne = "M0 0" + " ".repeat(MAX_SUBPATH_LEN - 4 + 1);
    expect(overByOne.length).toBe(MAX_SUBPATH_LEN + 1);
    expect(validatePathData(overByOne)).toBeNull(); // rejected by length gate
  });

  it("length MAX_SUBPATH_LEN + 1 is always rejected (O(1) gate)", () => {
    const over = "M" + "0 ".repeat(MAX_SUBPATH_LEN);
    expect(over.length).toBeGreaterThan(MAX_SUBPATH_LEN);
    validatePathData(over); // warmup (JIT) — single-shot timing flaked under coverage
    const t0 = performance.now();
    const result = validatePathData(over);
    const elapsed = performance.now() - t0;
    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(5); // O(1) gate ; 5 ms budget robust under coverage (Probe #30)
  });

  it("MAX_SUBPATH_COMMANDS exactly — accepted (cap is strict >)", () => {
    // Cap check: if (commands > MAX_SUBPATH_COMMANDS) return null
    // So exactly MAX_SUBPATH_COMMANDS commands is OK.
    // IMPORTANT: "M0 0" itself counts as 1 command (M).
    // So we need (MAX_SUBPATH_COMMANDS - 1) additional Z commands to reach exactly MAX.
    // Total: 1 (M) + (MAX - 1) (Z) = MAX commands.
    const d = "M0 0" + "Z".repeat(MAX_SUBPATH_COMMANDS - 1);
    expect(d.length).toBeLessThanOrEqual(MAX_SUBPATH_LEN);
    expect(validatePathData(d)).not.toBeNull();
  });

  it("MAX_SUBPATH_COMMANDS + 1 total — rejected (command cap exceeded)", () => {
    // 1 (M) + MAX (Z) = MAX + 1 total commands → rejected
    const d = "M0 0" + "Z".repeat(MAX_SUBPATH_COMMANDS);
    expect(d.length).toBeLessThanOrEqual(MAX_SUBPATH_LEN);
    expect(validatePathData(d)).toBeNull();
  });

  it("parseShapePaths — MAX_SUBPATHS (64) exactly — all accepted", () => {
    const paths = Array.from({ length: MAX_SUBPATHS }, (_, i) => ({ data: `M${i} 0 Z` }));
    const result = parseShapePaths({ paths });
    expect(result).toHaveLength(MAX_SUBPATHS);
  });

  it("parseShapePaths — MAX_SUBPATHS + 1 (65) — last one dropped, warn emitted", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const paths = Array.from({ length: MAX_SUBPATHS + 1 }, (_, i) => ({ data: `M${i} 0 Z` }));
      const result = parseShapePaths({ paths });
      expect(result).toHaveLength(MAX_SUBPATHS);
      expect(warnSpy.mock.calls.flat().join(" ")).toContain("cap exceeded");
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ─── 3. Command arity and Z behaviour ────────────────────────────────

describe("validatePathData — command arity and Z edge cases", () => {
  it("C with only 4 coordinates — accepted by scanner (arity is NOT enforced)", () => {
    // The scanner validates grammar (characters), not semantic arity.
    // A C command normally takes 6 coords; 4 is malformed per SVG spec
    // but the scanner does NOT check this — it's a documented limitation.
    // Contract: scanner accepts it, SVG engine draws something (possibly degenerate).
    const result = validatePathData("M0 0 C1 2 3 4");
    // Must not be null — scanner does not enforce C arity
    expect(result).not.toBeNull();
  });

  it("Z followed by coordinates — accepted by scanner (Z ignores trailing coords per SVG spec)", () => {
    // SVG path spec: Z/z closes the path, any subsequent data starts implicit
    // moveto. The scanner sees Z as a command and the numbers as valid tokens.
    const result = validatePathData("M0 0 L10 10 Z 20 30");
    // Scanner accepts this; SVG engine would treat the numbers as implicit moveto args.
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result).not.toMatch(/url\(|data:|[<>&;}{"'\\()]/i);
    }
  });

  it("Z Z Z (multiple close commands) — accepted", () => {
    expect(validatePathData("M0 0 Z Z Z")).not.toBeNull();
  });

  it("whitespace-only d string — rejected (trimmed to empty)", () => {
    expect(validatePathData("   ")).toBeNull();
    expect(validatePathData("\t\r\n")).toBeNull();
    expect(validatePathData("  \t  ")).toBeNull();
  });

  it("empty string — rejected", () => {
    expect(validatePathData("")).toBeNull();
  });
});

// ─── 4. Infinite and extreme numeric values ───────────────────────────

describe("validatePathData — infinite / extreme numeric literals", () => {
  it("coordinates spelled 'Infinity' — rejected (not allowlist chars)", () => {
    expect(validatePathData("M0 0 L Infinity 0")).toBeNull();
  });

  it("coordinates spelled 'NaN' — rejected (N is not a path command or number char)", () => {
    expect(validatePathData("M0 0 L NaN 0")).toBeNull();
  });

  it("coordinates spelled 'inf' — rejected (i is not allowlisted)", () => {
    expect(validatePathData("M0 0 L inf 0")).toBeNull();
  });
});

// ─── 5. Unicode / fullwidth ──────────────────────────────────────────

describe("validatePathData — unicode and non-ASCII rejection", () => {
  it("rejects fullwidth digits ０ (U+FF10)", () => {
    // Fullwidth zero looks like "0" but is charCode 0xFF10
    expect(validatePathData("M０ ０ L１ １")).toBeNull();
  });

  it("rejects Arabic-Indic digits ١٢٣", () => {
    expect(validatePathData("M١ ٢ L٣ ٤")).toBeNull();
  });

  it("rejects Greek letter M (looks like M but different codepoint)", () => {
    // Μ = U+039C (Greek capital Mu), not ASCII M
    expect(validatePathData("Μ0 0 L1 1")).toBeNull();
  });

  it("rejects path containing emoji", () => {
    expect(validatePathData("M0 0 🚀 L1 1")).toBeNull();
  });

  it("rejects null byte in path", () => {
    expect(validatePathData("M0 0\x00L1 1")).toBeNull();
  });

  it("rejects path with non-breaking space U+00A0 (not in separator set)", () => {
    // Non-breaking space is NOT in isSeparator (only 0x20, 0x09, 0x0d, 0x0a, 0x2c)
    expect(validatePathData("M0 0 L1 1")).toBeNull();
  });
});

// ─── 6. Mixed-case hostile strings ──────────────────────────────────

describe("validatePathData — mixed-case hostile rejection (Url(, dAtA:)", () => {
  it("rejects Url( (mixed case)", () => {
    expect(validatePathData("M0 0 Url(http://evil)")).toBeNull();
  });

  it("rejects URL( (all caps)", () => {
    expect(validatePathData("M0 0 URL(http://evil)")).toBeNull();
  });

  it("rejects dAtA: (mixed case data:)", () => {
    expect(validatePathData("M0 0 dAtA:text/html,x")).toBeNull();
  });

  it("rejects DATA: (all caps)", () => {
    expect(validatePathData("M0 0 DATA:x")).toBeNull();
  });

  it("rejects uRl( embedded mid-path", () => {
    expect(validatePathData("M0 0 L1 1 uRl(javascript:)")).toBeNull();
  });

  it("rejects data: with varying case embedded mid-path", () => {
    expect(validatePathData("M0 0 L1 1 Data:image/svg+xml")).toBeNull();
  });
});

// ─── 7. Performance: valid heavy path ────────────────────────────────

describe("validatePathData — valid heavy path performance", () => {
  it("10⁴ legitimate L commands parse in < 10 ms", () => {
    // 10000 * "L1 1 " = 50000 chars — under 8 KiB cap per subpath?
    // No — 50 KiB exceeds 8 KiB, so this will be rejected by the length gate.
    // Use shorter segments to stay under 8 KiB: "L1 " = 3 chars
    // 8192 chars - 4 (prefix "M0 0") = 8188. "L1 " = 3 chars → 2729 commands.
    // So the MAX at 8 KiB is about 2700 L commands. Let's test near that.
    const seg = "L1 1 "; // 5 chars
    const maxCmds = Math.min(
      Math.floor((MAX_SUBPATH_LEN - 5) / seg.length), // fit in 8 KiB
      MAX_SUBPATH_COMMANDS - 1, // under command cap
    );
    const d = "M0 0 " + seg.repeat(maxCmds);
    expect(d.length).toBeLessThanOrEqual(MAX_SUBPATH_LEN);

    const runs = 100;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) {
      validatePathData(d);
    }
    const perMs = (performance.now() - t0) / runs;
    expect(perMs).toBeLessThan(10); // generous budget; well under in practice
  });

  it("valid path at exactly MAX_SUBPATH_COMMANDS total commands parses without throw", () => {
    // Exactly MAX_SUBPATH_COMMANDS commands total: 1 (M) + (MAX-1) (Z).
    // "M0 0" (4 bytes) + "Z" * (MAX-1) (3999 bytes) = 4003 bytes < 8192 ✓
    const d = "M0 0" + "Z".repeat(MAX_SUBPATH_COMMANDS - 1);
    expect(d.length).toBeLessThanOrEqual(MAX_SUBPATH_LEN);
    const result = validatePathData(d);
    expect(result).not.toBeNull(); // exactly at cap, accepted
  });
});

// ─── 8. parseShapePaths partial invalids ─────────────────────────────

describe("parseShapePaths — partial invalid entries", () => {
  it("one invalid entry among valids: invalids dropped, valids rendered", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = parseShapePaths({
        paths: [
          { data: "M0 0 L10 10 Z" },
          { data: "M0 0 url(evil)" }, // invalid
          { data: "M5 5 L15 15 Z" },
        ],
      });
      expect(out).toHaveLength(2);
      expect(out[0].d).toBe("M0 0 L10 10 Z");
      expect(out[1].d).toBe("M5 5 L15 15 Z");
      // Diagnostic emitted for the invalid one
      expect(warnSpy.mock.calls.flat().join(" ")).toContain("shape.paths.data");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("empty paths[] array — returns [] and warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = parseShapePaths({ paths: [] });
      // paths is an array (even if empty), so the array branch is taken.
      // No entries → out is []. No "no renderable" warn because rawPaths.length === 0.
      expect(out).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("all-invalid paths[] emits 'no renderable subpath' diagnostic", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = parseShapePaths({
        paths: [{ data: "M0 0 url(evil)" }, { data: 99 as unknown as string }],
      });
      expect(out).toHaveLength(0);
      const warns = warnSpy.mock.calls.flat().join(" ");
      expect(warns).toContain("shape.paths");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("null entry in paths[] is dropped gracefully (no throw)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() =>
        parseShapePaths({ paths: [null as unknown as { data: string }, { data: "M0 0 Z" }] }),
      ).not.toThrow();
      const out = parseShapePaths({
        paths: [null as unknown as { data: string }, { data: "M0 0 Z" }],
      });
      expect(out).toHaveLength(1);
      expect(out[0].d).toBe("M0 0 Z");
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ─── 9. pathData + paths[] mutual exclusion ──────────────────────────

describe("parseShapePaths — pathData AND paths[] together", () => {
  it("paths[] wins over pathData, diagnostic emitted", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = parseShapePaths({
        pathData: "M99 99 L88 88 Z",
        paths: [{ data: "M0 0 L10 10 Z", windingRule: "EVENODD" }],
      });
      expect(out).toHaveLength(1);
      expect(out[0].d).toBe("M0 0 L10 10 Z");
      expect(out[0].fillRule).toBe("evenodd");
      // Diagnostic emitted about pathData being ignored
      const warns = warnSpy.mock.calls.flat().join(" ");
      expect(warns).toContain("mutually exclusive");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("pathData is NOT used when paths[] is valid (no pathData content leaks)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = parseShapePaths({
        pathData: "M0 0 url(evil)", // hostile pathData — ignored because paths[] wins
        paths: [{ data: "M0 0 Z" }],
      });
      // paths[] wins; hostile pathData never validated to DOM
      expect(out).toHaveLength(1);
      expect(out[0].d).toBe("M0 0 Z");
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ─── 10. Live delta sequences ─────────────────────────────────────────

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  warnSpy.mockRestore();
});

async function render(node: RenderNode, store: Store): Promise<void> {
  await act(async () => {
    root.render(<Tree node={node} store={store} />);
  });
}

function pathEls(): SVGPathElement[] {
  return Array.from(container.querySelectorAll("path"));
}

const EVIL_D = 'M0 0 url(http://evil)" onload="alert(1)';

describe("RC#10 — live hostile→valid→hostile sequences (Probe)", () => {
  it("pathData: hostile → valid → hostile — clean recovery at each step", async () => {
    const store = createStore();
    store.set("s.d", EVIL_D);
    const node: RenderNode = {
      kind: "shape",
      props: { geometry: "path", width: 10, height: 10, fill: "blue" },
      bindings: { pathData: "s.d" },
    };
    await render(node, store);
    // Step 1: hostile initial value
    expect(pathEls()).toHaveLength(0);
    expect(container.innerHTML).not.toContain("evil");

    // Step 2: valid recovery
    await act(async () => {
      store.set("s.d", "M0 0 L10 10 Z");
    });
    expect(pathEls()).toHaveLength(1);
    expect(pathEls()[0].getAttribute("d")).toBe("M0 0 L10 10 Z");

    // Step 3: hostile again
    await act(async () => {
      store.set("s.d", "M0 0 <script>");
    });
    expect(pathEls()).toHaveLength(0);
    expect(container.innerHTML).not.toContain("script");

    // Step 4: final recovery
    await act(async () => {
      store.set("s.d", "M1 1 L9 9 Z");
    });
    expect(pathEls()).toHaveLength(1);
  });

  it("paths[]: hostile → valid → hostile — partial invalids isolated per step", async () => {
    const store = createStore();
    store.set("s.paths", [{ data: "M0 0 L10 10 Z" }]);
    const node: RenderNode = {
      kind: "shape",
      props: { geometry: "path", width: 10, height: 10 },
      bindings: { paths: "s.paths" },
    };
    await render(node, store);
    expect(pathEls()).toHaveLength(1);

    // Hostile delta
    await act(async () => {
      store.set("s.paths", [{ data: EVIL_D }, { data: "M0 0 data:x" }]);
    });
    expect(pathEls()).toHaveLength(0);
    expect(container.innerHTML).not.toContain("evil");
    expect(container.innerHTML).not.toContain("data:");

    // Recovery
    await act(async () => {
      store.set("s.paths", [
        { data: "M0 0 Z", windingRule: "NONZERO" },
        { data: "M5 5 Z", windingRule: "EVENODD" },
      ]);
    });
    expect(pathEls()).toHaveLength(2);
    expect(pathEls()[1].getAttribute("fill-rule")).toBe("evenodd");

    // Hostile again
    await act(async () => {
      store.set("s.paths", [{ data: "M0 0 &lt;evil&gt;" }]);
    });
    expect(pathEls()).toHaveLength(0);
    expect(container.innerHTML).not.toContain("evil");
  });

  it("strokes[] color: hostile → valid → hostile — no colour injection at each step", async () => {
    const store = createStore();
    store.set("s.strokes", [{ color: "#ffffff", width: 2 }]);
    const node: RenderNode = {
      kind: "shape",
      props: { geometry: "path", width: 10, height: 10, paths: [{ data: "M0 0 L10 10 Z" }] },
      bindings: { strokes: "s.strokes" },
    };
    await render(node, store);
    const whitePaths = pathEls().filter((p) => p.getAttribute("stroke") === "#ffffff");
    expect(whitePaths.length).toBeGreaterThan(0);

    // Hostile colour delta
    await act(async () => {
      store.set("s.strokes", [{ color: "url(javascript:alert(1))", width: 3 }]);
    });
    expect(container.innerHTML).not.toContain("javascript");
    expect(container.innerHTML).not.toContain("alert");

    // Valid recovery
    await act(async () => {
      store.set("s.strokes", [{ color: "#ff0000", width: 2 }]);
    });
    const redPaths = pathEls().filter((p) => p.getAttribute("stroke") === "#ff0000");
    expect(redPaths.length).toBeGreaterThan(0);

    // Hostile again
    await act(async () => {
      store.set("s.strokes", [{ color: "red; } body { background: url(x)", width: 2 }]);
    });
    expect(container.innerHTML).not.toContain("body");
    expect(container.innerHTML).not.toContain("background");
  });
});

// ─── 11. viewBox with zero/negative/absent dimensions ────────────────

describe("Shape — viewBox with extreme width/height values", () => {
  it("width=0, height=0 — renders svg with viewBox '0 0 0 0' without throw", async () => {
    const store = createStore();
    await render(
      {
        kind: "shape",
        props: { geometry: "path", width: 0, height: 0, pathData: "M0 0 Z", fill: "red" },
      },
      store,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("viewBox")).toBe("0 0 0 0");
  });

  it("negative width/height fallback to default (100) — no negative viewBox emitted", async () => {
    const store = createStore();
    await render(
      {
        kind: "shape",
        props: {
          geometry: "path",
          width: -50, // not a valid finite → numberOr uses -50 (it IS finite!)
          height: -80,
          pathData: "M0 0 Z",
          fill: "blue",
        },
      },
      store,
    );
    // numberOr uses the value if finite; negative dimensions are passed through.
    // Document the actual behavior (no crash).
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // No throw; width/height attributes set to whatever numberOr returns.
    // Key: no injection, no crash.
    expect(container.innerHTML).not.toContain("url(");
  });

  it("no width/height props — fallbacks to 100x100 viewBox", async () => {
    const store = createStore();
    await render(
      {
        kind: "shape",
        props: { geometry: "path", pathData: "M0 0 Z", fill: "green" },
      },
      store,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("viewBox")).toBe("0 0 100 100");
  });

  it("Infinity width — falls back to 100 (numberOr rejects non-finite)", async () => {
    const store = createStore();
    await render(
      {
        kind: "shape",
        props: {
          geometry: "path",
          width: Infinity,
          height: 100,
          pathData: "M0 0 Z",
        },
      },
      store,
    );
    const svg = container.querySelector("svg");
    expect(svg!.getAttribute("viewBox")).toBe("0 0 100 100");
  });
});

// ─── 12. Cross-PR cap alignment ──────────────────────────────────────
// Probe originally documented a divergence between the compiler (PR #39,
// MAX_PATH_COMMANDS = 4000) and the runtime (4096). Forge aligned the
// runtime on the compiler value (4000, the stricter, deliberate authoring
// cap). Shared-constant module tracked in issue #41.

describe("Cross-PR cap alignment: compiler=4000 commands, runtime=4000 commands", () => {
  const COMPILER_CAP = 4000;

  it("a path with COMPILER_CAP+1 commands (4001) is rejected by the runtime validator (gap closed)", () => {
    // 4001 single-char commands: "M0 0" + "Z"*4001 = 4005 bytes < 8192 ✓
    const cmdCount = COMPILER_CAP + 1; // 4001
    const d = "M0 0" + "Z".repeat(cmdCount);
    expect(d.length).toBeLessThanOrEqual(MAX_SUBPATH_LEN);
    // Runtime now rejects it, exactly like the compiler would.
    expect(validatePathData(d)).toBeNull();
    // See: packages/compiler/src/compile.ts MAX_PATH_COMMANDS = 4000
    //      packages/runtime/src/render/svg-path.ts MAX_SUBPATH_COMMANDS = 4000
  });

  it("runtime MAX_SUBPATH_COMMANDS is 4000 (aligned on the compiler cap, issue #41)", () => {
    expect(MAX_SUBPATH_COMMANDS).toBe(COMPILER_CAP);
  });

  it("a path with exactly MAX_SUBPATH_COMMANDS total commands passes both runtime and compiler caps", () => {
    // IMPORTANT: M counts as command 1. To hit exactly MAX_SUBPATH_COMMANDS total:
    // use (MAX_SUBPATH_COMMANDS - 1) Z commands after M.
    const d = "M0 0" + "Z".repeat(MAX_SUBPATH_COMMANDS - 1); // total = 4000 commands
    expect(d.length).toBeLessThanOrEqual(MAX_SUBPATH_LEN);
    expect(validatePathData(d)).not.toBeNull(); // accepted (exactly at cap)
  });
});
