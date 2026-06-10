// Issue #34 — global R9 sentinel (ADR 001 §5.1 R9, §3.4).
//
// Contract : NO diagnostic path — structured channel OR console
// fallback — ever includes the value of a leaf / prop. Two layers :
//
//   1. BEHAVIOURAL — every known rejection path is triggered with a
//      value embedding a unique sentinel string ; everything captured
//      on the diagnostics channel and the console is then scanned for
//      the sentinel. A single leak fails the suite.
//   2. STATIC — `console.warn` may only exist in
//      `src/render/diagnostics.ts` (the single fallback site, which
//      formats exclusively from nodeId/field/reason). Any new warn
//      call site must route through `emitDiagnostic`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { Tree } from "../../src/render/tree.js";
import { addDiagnosticsHandler, type RenderDiagnostic } from "../../src/render/diagnostics.js";
import { mountPlay } from "../../src/animate/transitions.js";
import { compileForFramer } from "../../src/animate/keyframes.js";
import { resolveTypography, parseFontFamily } from "../../src/render/primitives/text.js";
import { sanitizeFills, backgroundsToCss, type Fill } from "../../src/render/fill.js";
import { parseShapePaths } from "../../src/render/svg-path.js";
import { createStore } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";

// Unique, grammar-hostile sentinel : rejected by every strict parser
// (colour, path, filter, typography enums, fontFamily) while remaining
// easy to grep in captured output.
const SENTINEL = "R9SENTINEL4f7a2c";
const EVIL = `${SENTINEL}; } body { background: url(http://${SENTINEL}) `;

let container: HTMLDivElement;
let root: Root;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let diagnostics: RenderDiagnostic[];
let removeHandler: () => void;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  diagnostics = [];
  removeHandler = addDiagnosticsHandler((d) => diagnostics.push(d));
});

afterEach(async () => {
  removeHandler();
  await act(async () => root.unmount());
  container.remove();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

/** Everything any diagnostic consumer could ever observe. */
function observedOutput(): string {
  return [
    JSON.stringify(diagnostics),
    ...warnSpy.mock.calls.flat().map(String),
    ...errorSpy.mock.calls.flat().map(String),
  ].join(" || ");
}

async function render(node: RenderNode, store = createStore()): Promise<void> {
  await act(async () => {
    root.render(<Tree node={node} store={store} />);
  });
}

describe("R9 sentinel — no diagnostic path carries a value", () => {
  it("static + live render rejections : colour, typo, font, clips, paths, fills, unknown prop", async () => {
    const store = createStore();
    store.set("live.colour", "#fff");
    await render(
      {
        kind: "frame",
        id: "frame-1",
        props: {
          background: EVIL,
          clipsContent: EVIL,
          backgrounds: [{ kind: "solid", color: EVIL }],
        },
        children: [
          {
            kind: "text",
            id: "text-1",
            props: {
              value: "on-air",
              colour: EVIL,
              font: EVIL,
              textTransform: EVIL,
              textDecoration: EVIL,
              fontStyle: EVIL,
              letterSpacing: EVIL,
              lineHeight: EVIL,
              maxLines: EVIL,
              unknownProp: EVIL,
            },
            bindings: { colour: "live.colour" },
          },
          {
            kind: "shape",
            id: "shape-1",
            props: {
              geometry: "path",
              pathData: EVIL,
              paths: [{ data: EVIL }, { data: "M 0 0 L 1 1", windingRule: EVIL }],
              fill: EVIL,
              stroke: EVIL,
              fills: [
                { kind: "solid", color: EVIL },
                { kind: "linear-gradient", stops: [{ offset: 0, color: EVIL }] },
              ],
            },
          },
          { kind: "instance", id: "inst-1", props: { params: { secret: SENTINEL } } },
        ],
      },
      store,
    );
    // Live hostile delta through a bound prop.
    await act(async () => {
      store.set("live.colour", EVIL);
    });

    expect(diagnostics.length).toBeGreaterThan(8); // every path actually fired
    expect(observedOutput()).not.toContain(SENTINEL);
  });

  it("animate_initial.filter and keyframe filter rejections", () => {
    mountPlay({ opacity: 1 }, { filter: EVIL }, "anim-1");
    compileForFramer(
      {
        steps: [
          { at: 0, filter: EVIL },
          { at: 1, opacity: 1 },
        ],
        duration_ms: 100,
      },
      "kf-1",
    );
    expect(diagnostics.length).toBeGreaterThanOrEqual(2);
    expect(observedOutput()).not.toContain(SENTINEL);
  });

  it("bindAnimate live rejection (scalar + colour channels)", async () => {
    const store = createStore();
    store.set("s.op", EVIL);
    store.set("s.col", EVIL);
    await render(
      {
        kind: "shape",
        id: "ba-1",
        props: { geometry: "rect" },
        animateBindings: { opacity: "s.op", fill: "s.col" },
      },
      store,
    );
    expect(diagnostics.some((d) => d.field === "bindAnimate.opacity" && d.nodeId === "ba-1")).toBe(
      true,
    );
    expect(diagnostics.some((d) => d.field === "bindAnimate.fill")).toBe(true);
    expect(observedOutput()).not.toContain(SENTINEL);
  });

  it("pure helpers reject without echoing (boundary)", () => {
    resolveTypography({ textTransform: EVIL, letterSpacing: EVIL }, "n");
    expect(parseFontFamily(EVIL)).toBeNull();
    sanitizeFills([{ kind: "solid", color: EVIL } as Fill], "shape.fills", "n");
    backgroundsToCss([{ kind: "solid", color: EVIL } as Fill], "n");
    parseShapePaths({ pathData: EVIL }, "n");
    expect(observedOutput()).not.toContain(SENTINEL);
  });
});

describe("R9 sentinel — static guarantee", () => {
  it("console.warn exists only in src/render/diagnostics.ts", () => {
    // vitest's cwd is the package root (vitest.config.ts location).
    const srcRoot = join(process.cwd(), "src");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        if (full.replaceAll("\\", "/").endsWith("src/render/diagnostics.ts")) continue;
        if (readFileSync(full, "utf8").includes("console.warn(")) {
          offenders.push(full);
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
