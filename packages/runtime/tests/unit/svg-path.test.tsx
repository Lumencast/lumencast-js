// Shape path rendering (LSML 1.1 §4.6) — ADR 001 §6 RC#3 + RC#10 + RC#12
// (issue #30).
//
// Four layers of proof :
//   1. validator unit — strict `d` grammar accept/reject incl. Bastion's
//      hostile fixtures (`url(`, `data:`, `<`, `&`), 8 KiB / command caps ;
//   2. anti-ReDoS — adversarial corpus incl. the 10⁶-command payload
//      (rejected without freeze) + fuzz, ≤ 1 ms per validated value ;
//   3. DOM smoke (RC#3) — 2 subpaths with mixed winding produce 2 <path>
//      with correct fill-rule ; pathData ≡ paths[] equivalence ; viewBox ;
//   4. render integration (RC#10) — hostile `d` AND hostile colours
//      neutralised as STATIC props and as LIVE deltas post-mount
//      (props are wire-drivable through `resolveProps`, tree.tsx) ;
//      diagnostics never leak the value (R9) ; no silent drop.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

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

// ─── 1. validator unit (RC#10 grammar) ───────────────────────────────

const HOSTILE_D: string[] = [
  "M0 0 url(http://evil)",
  "M0 0 URL(javascript:alert(1))",
  "url(#x)",
  "M0 0 data:text/html,x",
  "M0 0 DATA:x",
  "M0 0 <script>alert(1)</script>",
  "M0 0 &lt;x&gt;",
  "M0 0 &#x3c;",
  'M0 0" onload="alert(1)',
  "M0 0; background: red",
  "M0 0 } body {",
  "M0 0 expression(1)",
  "M0 0 e(1)",
  "javascript:alert(1)",
  "L10 10 Z", // must start with a moveto
  "10 10 M0 0", // number before any command
  "M0 0 L1.. 2", // malformed number (double dot handled : 1. then .2 ? no — "1.." → "1." ok then "." alone rejected)
  "M0 0 L- 2", // bare sign
  "M0 0 L1e 2", // empty exponent
  "M0 0 Lée", // non-ASCII
  "M0 0 B1 2", // B is not a path command
  "",
  " ",
];

describe("validatePathData — strict grammar (RC#10)", () => {
  it.each([
    "M0,0 L120,0 L120,80 L0,80 Z",
    "M30,20 L90,20 L90,60 L30,60 Z",
    "M 0 0 L 10 10",
    "m0 0 l10 10 h5 v5 z",
    "M0 0 C1 2 3 4 5 6 S7 8 9 10 Q1 2 3 4 T5 6",
    "M0 0 A25 25 0 0 1 50 50",
    "M-1.5,+2.5 L.5 -.5",
    "M1e3 2E-2 L1.5e+10 0",
    "M0 0\tL1 1\r\nZ",
  ])("accepts %j", (input) => {
    expect(validatePathData(input)).not.toBeNull();
  });

  it.each(HOSTILE_D)("rejects hostile %j", (input) => {
    expect(validatePathData(input)).toBeNull();
  });

  it.each([null, undefined, 42, ["M0 0"], { d: "M0 0" }])(
    "rejects non-string %j (never passthrough)",
    (input) => {
      expect(validatePathData(input)).toBeNull();
    },
  );

  it("enforces the 8 KiB per-subpath cap (RC#10)", () => {
    const seg = "L1 1 ";
    const fill = seg.repeat(Math.floor((MAX_SUBPATH_LEN - 5) / seg.length));
    const ok = ("M0 0 " + fill).slice(0, MAX_SUBPATH_LEN);
    expect(ok.length).toBeLessThanOrEqual(MAX_SUBPATH_LEN);
    expect(validatePathData(ok.trimEnd())).not.toBeNull();
    expect(validatePathData("M0 0 " + seg.repeat(2000))).toBeNull(); // > 8 KiB
  });

  it("enforces the command cap even under the length cap", () => {
    // "Z" repeated : 1 command per char — exceeds the command cap while
    // staying under 8 KiB.
    const d = "M0 0" + "Z".repeat(MAX_SUBPATH_COMMANDS + 10);
    expect(d.length).toBeLessThanOrEqual(MAX_SUBPATH_LEN);
    expect(validatePathData(d)).toBeNull();
    expect(validatePathData("M0 0" + "Z".repeat(100))).not.toBeNull();
  });
});

describe("parseShapePaths — §4.6 resolution", () => {
  it("pathData ≡ paths:[{data, windingRule:NONZERO}] (spec equivalence)", () => {
    const viaPathData = parseShapePaths({ pathData: "M0 0 L10 10 Z" });
    const viaPaths = parseShapePaths({ paths: [{ data: "M0 0 L10 10 Z" }] });
    expect(viaPathData).toEqual([{ d: "M0 0 L10 10 Z", fillRule: "nonzero" }]);
    expect(viaPaths).toEqual(viaPathData);
  });

  it("maps windingRule to fill-rule, defaulting to nonzero", () => {
    const out = parseShapePaths({
      paths: [
        { data: "M0 0 Z", windingRule: "NONZERO" },
        { data: "M1 1 Z", windingRule: "EVENODD" },
        { data: "M2 2 Z" },
        { data: "M3 3 Z", windingRule: "SPIRAL" }, // unknown → nonzero + warn
      ],
    });
    expect(out.map((p) => p.fillRule)).toEqual(["nonzero", "evenodd", "nonzero", "nonzero"]);
  });

  it("caps the number of subpaths (RC#10)", () => {
    const paths = Array.from({ length: MAX_SUBPATHS + 8 }, (_, i) => ({ data: `M${i} 0 Z` }));
    expect(parseShapePaths({ paths })).toHaveLength(MAX_SUBPATHS);
  });

  it("drops invalid entries, keeps valid ones", () => {
    const out = parseShapePaths({
      paths: [{ data: "M0 0 Z" }, { data: "M0 0 url(http://evil)" }, { data: 42 }, null],
    });
    expect(out).toEqual([{ d: "M0 0 Z", fillRule: "nonzero" }]);
  });
});

// ─── 2. anti-ReDoS / anti-freeze (RC#10 + RC#12) ─────────────────────

describe("validatePathData — adversarial payloads (RC#10/RC#12)", () => {
  // Timing budget : 5 ms averaged. 1 ms was flaky under coverage
  // instrumentation (istanbul counters + cold JIT inflate the first
  // iterations) ; 5 ms still catches any super-linear regression by
  // orders of magnitude while staying deterministic in CI (Probe #30).
  const PER_VALUE_BUDGET_MS = 5;

  it("rejects a 10⁶-command `d` without freezing (length-cap short-circuit)", () => {
    const million = "M0 0 " + "L1 1 ".repeat(1_000_000); // ~5 MB
    validatePathData(million); // warmup (JIT) before measuring
    const start = performance.now();
    for (let i = 0; i < 200; i++) expect(validatePathData(million)).toBeNull();
    const perValue = (performance.now() - start) / 200;
    expect(perValue).toBeLessThanOrEqual(PER_VALUE_BUDGET_MS);
  });

  it("validates every adversarial payload in ≤ 5 ms (averaged over 200 runs)", () => {
    const adversarial: string[] = [
      "M" + "1".repeat(8000), // one huge number
      "M0 0 " + "Z".repeat(8000), // command-cap probe
      "M0 0 " + "1 ".repeat(4000), // number flood
      "M0 0 " + "-".repeat(8000), // bare-sign flood
      "M0 0 " + ".".repeat(8000), // bare-dot flood
      "M" + "e".repeat(8000), // exponent-char flood
      "M0 0 L1 1 " + "url(".repeat(2000),
      "M" + " ".repeat(8000) + "0",
      "Z".repeat(8192),
      "M0 0 1e" + "9".repeat(8000),
    ];
    for (const payload of adversarial) {
      validatePathData(payload); // warmup (JIT) before measuring
      const runs = 200;
      const start = performance.now();
      for (let i = 0; i < runs; i++) validatePathData(payload);
      const perValue = (performance.now() - start) / runs;
      expect(perValue, `payload ${payload.slice(0, 24)}… took ${perValue} ms`).toBeLessThanOrEqual(
        PER_VALUE_BUDGET_MS,
      );
    }
  });

  it("fuzz : 5 000 random inputs — no throw, no unsafe output, ≤ 5 ms each on average", () => {
    const rnd = mulberry32(30);
    const charset = "MmLlZzAaCc0123456789-+.eE ,url(data:<>&;}{\"'\\\n\t";
    const runs = 5_000;
    const start = performance.now();
    for (let i = 0; i < runs; i++) {
      const len = Math.floor(rnd() * 256);
      let s = "";
      for (let j = 0; j < len; j++) s += charset[Math.floor(rnd() * charset.length)];
      const out = validatePathData(s);
      if (out !== null) {
        // Invariant : an accepted value can never carry an injection
        // metacharacter, whatever the input shape.
        expect(out).not.toMatch(/url\(|data:|[<>&;}{"'\\()]/i);
      }
    }
    const perValue = (performance.now() - start) / runs;
    expect(perValue).toBeLessThanOrEqual(PER_VALUE_BUDGET_MS);
  });
});

/** Deterministic PRNG so the fuzz corpus is reproducible in CI. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── 3 + 4. DOM integration (RC#3 smoke, RC#10 live deltas, RC#11) ───

let container: HTMLDivElement;
let root: Root;
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

const EVIL_D = 'M0 0 url(http://evil)" onload="alert(1)';
const EVIL_COLOR = "red; } body { background: url(http://evil) ; } x {";

function pathEls(): SVGPathElement[] {
  return Array.from(container.querySelectorAll("path"));
}

describe("RC#3 — shape geometry:path DOM smoke (happy-dom)", () => {
  it("2 subpaths with mixed winding → 2 <path> with correct fill-rule", async () => {
    const store = createStore();
    await render(
      {
        kind: "shape",
        props: {
          geometry: "path",
          width: 120,
          height: 80,
          paths: [
            { data: "M0,0 L120,0 L120,80 L0,80 Z", windingRule: "NONZERO" },
            { data: "M30,20 L90,20 L90,60 L30,60 Z", windingRule: "EVENODD" },
          ],
          fills: [{ kind: "solid", color: "#ff7e00" }],
        },
      },
      store,
    );
    const paths = pathEls();
    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute("d")).toBe("M0,0 L120,0 L120,80 L0,80 Z");
    expect(paths[0].getAttribute("fill-rule")).toBe("nonzero");
    expect(paths[0].getAttribute("fill")).toBe("#ff7e00");
    expect(paths[1].getAttribute("d")).toBe("M30,20 L90,20 L90,60 L30,60 Z");
    expect(paths[1].getAttribute("fill-rule")).toBe("evenodd");
    // viewBox from size (spec recommendation §4.6).
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 120 80");
  });

  it("pathData single-path shorthand renders one <path> with nonzero", async () => {
    const store = createStore();
    await render(
      {
        kind: "shape",
        props: { geometry: "path", width: 10, height: 10, pathData: "M0 0 L10 10 Z", fill: "red" },
      },
      store,
    );
    const paths = pathEls();
    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute("fill-rule")).toBe("nonzero");
    expect(paths[0].getAttribute("fill")).toBe("red");
  });

  it("strokes[] apply to the union of subpaths (one stroke pass per layer)", async () => {
    const store = createStore();
    await render(
      {
        kind: "shape",
        props: {
          geometry: "path",
          width: 10,
          height: 10,
          paths: [{ data: "M0 0 L10 10 Z" }, { data: "M1 1 L9 9 Z" }],
          strokes: [{ color: "#ffffff", width: 1 }],
        },
      },
      store,
    );
    const stroked = pathEls().filter((p) => p.getAttribute("stroke") === "#ffffff");
    expect(stroked).toHaveLength(2);
    expect(stroked.every((p) => p.getAttribute("stroke-width") === "1")).toBe(true);
  });

  it("geometry:path with no path props renders nothing but warns (no silent drop)", async () => {
    const store = createStore();
    await render({ kind: "shape", props: { geometry: "path", width: 10, height: 10 } }, store);
    expect(pathEls()).toHaveLength(0);
    expect(warnSpy.mock.calls.flat().map(String).join(" ")).toContain("shape.paths");
  });
});

describe("RC#10 — hostile path data neutralised (static AND live delta)", () => {
  it("static hostile `d` never reaches the DOM, diagnostic emitted without the value (R9)", async () => {
    const store = createStore();
    await render(
      {
        kind: "shape",
        props: {
          geometry: "path",
          width: 10,
          height: 10,
          paths: [{ data: EVIL_D }],
          fills: [{ kind: "solid", color: "#112233" }],
        },
      },
      store,
    );
    expect(pathEls()).toHaveLength(0);
    expect(container.innerHTML).not.toContain("evil");
    expect(container.innerHTML).not.toContain("url(http");
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.length).toBeGreaterThan(0);
    for (const arg of calls) {
      expect(arg).not.toContain("evil");
      expect(arg).not.toContain(EVIL_D);
    }
    expect(calls.join(" ")).toContain("shape.paths");
  });

  it("LIVE hostile delta post-mount is rejected ; a valid delta recovers", async () => {
    const store = createStore();
    store.set("s.paths", [{ data: "M0 0 L10 10 Z" }]);
    const node: RenderNode = {
      kind: "shape",
      props: { geometry: "path", width: 10, height: 10, fills: [{ kind: "solid", color: "red" }] },
      bindings: { paths: "s.paths" },
    };
    await render(node, store);
    expect(pathEls()).toHaveLength(1);
    expect(pathEls()[0].getAttribute("d")).toBe("M0 0 L10 10 Z");

    // Hostile delta arriving on the live wire AFTER mount (resolveProps).
    await act(async () => {
      store.set("s.paths", [{ data: EVIL_D }, { data: "M0 0 data:x" }]);
    });
    expect(pathEls()).toHaveLength(0);
    expect(container.innerHTML).not.toContain("evil");
    expect(container.innerHTML).not.toContain("data:");

    // A subsequent valid delta recovers.
    await act(async () => {
      store.set("s.paths", [{ data: "M1 1 L2 2 Z", windingRule: "EVENODD" }]);
    });
    expect(pathEls()).toHaveLength(1);
    expect(pathEls()[0].getAttribute("d")).toBe("M1 1 L2 2 Z");
    expect(pathEls()[0].getAttribute("fill-rule")).toBe("evenodd");
  });

  it("LIVE pathData delta : hostile shorthand rejected too", async () => {
    const store = createStore();
    store.set("s.d", "M0 0 L5 5");
    const node: RenderNode = {
      kind: "shape",
      props: { geometry: "path", width: 10, height: 10, fill: "blue" },
      bindings: { pathData: "s.d" },
    };
    await render(node, store);
    expect(pathEls()).toHaveLength(1);
    await act(async () => {
      store.set("s.d", "M0 0 <script>alert(1)</script>");
    });
    expect(pathEls()).toHaveLength(0);
    expect(container.innerHTML).not.toContain("script");
  });

  it("10⁶-command live delta is rejected without freezing the renderer", async () => {
    const store = createStore();
    store.set("s.d", "M0 0 L5 5");
    const node: RenderNode = {
      kind: "shape",
      props: { geometry: "path", width: 10, height: 10, fill: "blue" },
      bindings: { pathData: "s.d" },
    };
    await render(node, store);
    const million = "M0 0 " + "L1 1 ".repeat(1_000_000);
    const start = performance.now();
    await act(async () => {
      store.set("s.d", million);
    });
    expect(performance.now() - start).toBeLessThan(500); // no freeze
    expect(pathEls()).toHaveLength(0);
  });
});

describe("RC#11 — path colours go through the strict parser (issue #30 contract)", () => {
  it("hostile fills[] solid colour drops the layer on a path (static)", async () => {
    const store = createStore();
    await render(
      {
        kind: "shape",
        props: {
          geometry: "path",
          width: 10,
          height: 10,
          paths: [{ data: "M0 0 L10 10 Z" }],
          fills: [
            { kind: "solid", color: EVIL_COLOR },
            { kind: "solid", color: "#112233" },
          ],
        },
      },
      store,
    );
    expect(container.innerHTML).not.toContain("evil");
    const fills = pathEls().map((p) => p.getAttribute("fill"));
    expect(fills).toEqual(["#112233"]); // hostile layer dropped, valid kept
  });

  it("hostile gradient stop colour drops the layer (SVG <stop> site)", async () => {
    const store = createStore();
    await render(
      {
        kind: "shape",
        props: {
          geometry: "path",
          width: 10,
          height: 10,
          paths: [{ data: "M0 0 L10 10 Z" }],
          fills: [
            {
              kind: "linear-gradient",
              stops: [
                { offset: 0, color: "red 0%, transparent) , url(http://x" },
                { offset: 1, color: "blue" },
              ],
            },
          ],
        },
      },
      store,
    );
    expect(container.innerHTML).not.toContain("evil");
    expect(container.querySelectorAll("stop")).toHaveLength(0); // layer dropped entirely
    // No fills[] survive → the safe legacy fallback (transparent) applies.
    expect(pathEls().map((p) => p.getAttribute("fill"))).toEqual(["transparent"]);
    expect(container.innerHTML).not.toContain("url(http");
  });

  it("valid gradient still renders its stops for a path fill", async () => {
    const store = createStore();
    await render(
      {
        kind: "shape",
        props: {
          geometry: "path",
          width: 10,
          height: 10,
          paths: [{ data: "M0 0 L10 10 Z" }],
          fills: [
            {
              kind: "linear-gradient",
              stops: [
                { offset: 0, color: "#ff7e00" },
                { offset: 1, color: "#ff1a3d" },
              ],
            },
          ],
        },
      },
      store,
    );
    const stops = Array.from(container.querySelectorAll("stop"));
    expect(stops.map((s) => s.getAttribute("stop-color"))).toEqual(["#ff7e00", "#ff1a3d"]);
    expect(pathEls()[0].getAttribute("fill")).toMatch(/^url\(#lumen-grad-/);
  });

  it("hostile legacy fill / strokes[] colour on a path (LIVE delta) falls back safely", async () => {
    const store = createStore();
    store.set("s.fill", "#00ff00");
    store.set("s.strokes", [{ color: "#ffffff", width: 2 }]);
    const node: RenderNode = {
      kind: "shape",
      props: { geometry: "path", width: 10, height: 10, paths: [{ data: "M0 0 L10 10 Z" }] },
      bindings: { fill: "s.fill", strokes: "s.strokes" },
    };
    await render(node, store);
    expect(pathEls()[0].getAttribute("fill")).toBe("#00ff00");

    await act(async () => {
      store.set("s.fill", EVIL_COLOR);
      store.set("s.strokes", [{ color: "url(javascript:alert(1))", width: 2 }]);
    });
    expect(container.innerHTML).not.toContain("evil");
    expect(container.innerHTML).not.toContain("javascript");
    expect(pathEls()[0].getAttribute("fill")).toBe("transparent");
    // R9 — diagnostics never leak the rejected values.
    for (const arg of warnSpy.mock.calls.flat().map(String)) {
      expect(arg).not.toContain("evil");
      expect(arg).not.toContain("javascript");
    }
  });
});
