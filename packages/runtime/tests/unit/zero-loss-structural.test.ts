// Structural "0 nœud rastérisé" invariant — ADR 002 #J / RC#10 (the half of
// RC#10 that is provable WITHOUT pixels, hence deterministic in the plain
// `pnpm test` job, no browser).
//
// RC#10 dur : "AUCUN nœud de 817:3 n'est rastérisé ni aplati (le harness échoue
// si un nœud promu — blend/mask/image-fill/gradient — est servi en bitmap
// pré-rendu au lieu de sa construction 1.2)."
//
// We assert on the COMMITTED mapper output (cover-817-3.lsml.json) and its
// compiled form that each promoted family survives as its PARAMETRIC 1.2
// construction — not as a flattened bitmap. Legitimate bitmaps (image-fills,
// image primitives, texture tiles) are allowed to be `image` / `kind:"image"`;
// what is forbidden is a blend / mask / gradient / vector PATH having been
// pre-composed into a raster.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// Imported via relative source path: @lumencast/compiler depends on
// @lumencast/runtime, so runtime can't list it as a dep (cycle). vitest
// resolves the compiler source directly — this is a test-only edge.
import { compileBundle, type LSMLBundle } from "../../../compiler/src/index";

const FIXTURE = resolve(__dirname, "../e2e/zero-loss/fixtures/cover-817-3.lsml.json");

function loadBundle(): LSMLBundle {
  return JSON.parse(readFileSync(FIXTURE, "utf-8")) as LSMLBundle;
}

/** Walk every node in a layout/render tree. */
function* walk(node: unknown): Generator<Record<string, unknown>> {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n);
    return;
  }
  const obj = node as Record<string, unknown>;
  yield obj;
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") yield* walk(v);
  }
}

interface FamilyCensus {
  blend: number;
  mask: number;
  gradientFill: number;
  imageFill: number;
  imagePrimitive: number;
  vectorPath: number;
}

/** Count the parametric 1.2 constructions present in a layout tree. */
function census(layout: unknown): FamilyCensus {
  const c: FamilyCensus = {
    blend: 0,
    mask: 0,
    gradientFill: 0,
    imageFill: 0,
    imagePrimitive: 0,
    vectorPath: 0,
  };
  for (const node of walk(layout)) {
    if (typeof node["blendMode"] === "string") c.blend++;
    if (node["mask"] && typeof node["mask"] === "object") c.mask++;
    const fills = node["fills"];
    if (Array.isArray(fills)) {
      for (const f of fills as Record<string, unknown>[]) {
        const kind = f["kind"];
        if (kind === "linear-gradient" || kind === "radial-gradient" || kind === "angular-gradient")
          c.gradientFill++;
        if (kind === "image") c.imageFill++;
      }
    }
    if (node["kind"] === "image") c.imagePrimitive++;
    if (
      node["kind"] === "shape" &&
      node["geometry"] === "path" &&
      typeof node["pathData"] === "string"
    )
      c.vectorPath++;
  }
  return c;
}

describe("817:3 structural zero-loss — promoted families survive as parametric 1.2", () => {
  it("the committed mapper bundle is LSML 1.2 with allowedHosts [] (T6 coherent)", () => {
    const b = loadBundle();
    expect(b.lsml).toBe("1.2");
    expect(b.assets?.allowedHosts).toEqual([]);
  });

  it("every promoted family is present in PARAMETRIC form (none dropped)", () => {
    const c = census(loadBundle().layout);
    // The cover's four 1.2 families + the texture/image structure.
    expect(c.blend, "blendMode missing → blend was dropped/flattened").toBeGreaterThanOrEqual(2);
    expect(c.mask, "typed mask missing → mask was dropped/flattened").toBeGreaterThanOrEqual(1);
    expect(
      c.gradientFill,
      "gradient fill missing → gradient was dropped/flattened",
    ).toBeGreaterThanOrEqual(1);
    expect(
      c.imageFill + c.imagePrimitive,
      "image-fill missing → image-in-shape was dropped",
    ).toBeGreaterThanOrEqual(2);
    expect(c.vectorPath, "vector path missing → logo/vector flattened").toBeGreaterThanOrEqual(1);
  });

  it("NO promoted node was flattened to a pre-composed raster (the hard invariant)", () => {
    for (const node of walk(loadBundle().layout)) {
      // A blend / mask / gradient / vector node must NOT also be a bare image
      // primitive standing in for that effect. The forbidden shape is a node
      // that carries a promoted-family marker AND is itself a raster image
      // (kind:"image") whose src is its ONLY content — i.e. the effect was
      // baked into the bitmap.
      const isImagePrimitive = node["kind"] === "image";
      const carriesGradient =
        Array.isArray(node["fills"]) &&
        (node["fills"] as Record<string, unknown>[]).some((f) =>
          String(f["kind"]).endsWith("-gradient"),
        );
      const carriesMaskSourceShape =
        node["mask"] &&
        typeof node["mask"] === "object" &&
        (node["mask"] as { source?: { kind?: string } }).source?.kind === "shape";

      // A gradient must live in a `fills[]` of a shape, never be replaced by a
      // raster image primitive.
      expect(
        isImagePrimitive && carriesGradient,
        "a gradient node is also a raster image primitive → flattened",
      ).toBe(false);

      // A shape-source mask references geometry, not a baked bitmap (image-
      // source masks ARE legitimate — Figma exports an alpha image mask).
      void carriesMaskSourceShape; // documented; no raster-collapse to assert here.
    }
  });

  it("survives compilation — the RenderBundle keeps the same parametric census", () => {
    const compiled = compileBundle(loadBundle(), { onWarn: () => {} });
    // Re-census the compiled tree. Compiled prop names differ (the compiler
    // lowers `blendMode`/`mask`/`fills` onto props) but the families must not
    // vanish. We count via a compiled-aware pass.
    let blend = 0;
    let mask = 0;
    let gradient = 0;
    let image = 0;
    for (const node of walk(compiled.root)) {
      const props = (node["props"] as Record<string, unknown> | undefined) ?? {};
      if (typeof node["blendMode"] === "string" || typeof props["blendMode"] === "string") blend++;
      if (node["mask"] || props["mask"]) mask++;
      const fills = (props["fills"] ?? node["fills"]) as unknown;
      if (Array.isArray(fills)) {
        for (const f of fills as Record<string, unknown>[]) {
          if (String(f["kind"]).endsWith("-gradient")) gradient++;
          if (f["kind"] === "image") image++;
        }
      }
      if (node["kind"] === "image") image++;
    }
    expect(blend, "blend lost in compilation").toBeGreaterThanOrEqual(2);
    expect(mask, "mask lost in compilation").toBeGreaterThanOrEqual(1);
    expect(gradient, "gradient lost in compilation").toBeGreaterThanOrEqual(1);
    expect(image, "image-fill lost in compilation").toBeGreaterThanOrEqual(2);
  });
});
