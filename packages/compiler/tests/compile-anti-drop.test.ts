// Issue #34 — consumed-key accounting (ADR 001 §3.4 D4, §5.1 R9, §6 RC#7).
//
// Policy under test : every key present in the LSML source and NOT
// consumed by the lowering produces an `onWarn` diagnostic — structured
// (node.id + field + reason), never the value (R9). `strict: true`
// turns every warning into a throw. `metadata` blocks are exempt
// (advisory by construction, §17.5.1).

import { describe, expect, it } from "vitest";
import {
  compileBundle,
  ZERO_HASH,
  type CompileDiagnostic,
  type LSMLBundle,
  type LSMLNode,
} from "../src/index.js";

const SENTINEL = "R9SENTINEL4f7a2c";

function bundle(layout: LSMLNode, extra: Record<string, unknown> = {}): LSMLBundle {
  return { lsml: "1.1", scene_id: "t", scene_version: ZERO_HASH, layout, ...extra } as LSMLBundle;
}

function collect(b: LSMLBundle): { messages: string[]; diagnostics: CompileDiagnostic[] } {
  const messages: string[] = [];
  const diagnostics: CompileDiagnostic[] = [];
  compileBundle(b, {
    onWarn: (message, diagnostic) => {
      messages.push(message);
      diagnostics.push(diagnostic);
    },
  });
  return { messages, diagnostics };
}

describe("node-level consumed-key accounting", () => {
  it("an unknown extension key warns with node.id + field, never the value", () => {
    const { messages, diagnostics } = collect(
      bundle({
        kind: "frame",
        id: "hero",
        effects: [{ kind: "drop-shadow", note: SENTINEL }],
      } as unknown as LSMLNode),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "hero", field: "effects" }),
    );
    const all = messages.join(" ") + JSON.stringify(diagnostics);
    expect(all).not.toContain(SENTINEL);
  });

  it("spec'd-but-dropped keys warn : repeat.limit / repeat.key", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "repeat",
        id: "list",
        scope: "row",
        bind: { items: "rows" },
        template: { kind: "text", id: "cell" },
        limit: 10,
        key: "row.id",
      } as unknown as LSMLNode),
    );
    expect(diagnostics).toContainEqual(expect.objectContaining({ nodeId: "list", field: "limit" }));
    expect(diagnostics).toContainEqual(expect.objectContaining({ nodeId: "list", field: "key" }));
  });

  it("nested text style accounting : unknown style.* key warns", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "text",
        id: "title",
        style: { fontSize: 12, textShadow: SENTINEL },
      } as unknown as LSMLNode),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "title", field: "style.textShadow" }),
    );
    expect(JSON.stringify(diagnostics)).not.toContain(SENTINEL);
  });

  it("children are audited recursively", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "stack",
        id: "root",
        children: [{ kind: "shape", id: "inner", geometry: "rect", mask: "x" }],
      } as unknown as LSMLNode),
    );
    expect(diagnostics).toContainEqual(expect.objectContaining({ nodeId: "inner", field: "mask" }));
  });

  it("anonymous node reports <anon>", () => {
    const { diagnostics } = collect(
      bundle({ kind: "frame", blendMode: "x" } as unknown as LSMLNode),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "<anon>", field: "blendMode" }),
    );
  });
});

describe("exemptions (advisory by design)", () => {
  it("metadata.* never warns — node and bundle level (§17.5.1 advisory)", () => {
    const { diagnostics } = collect(
      bundle(
        { kind: "frame", id: "f", metadata: { figma: { nodeId: "1:2" } } },
        { metadata: { exporter: "figma-plugin" } },
      ),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("a fully spec'd 1.1 node compiles without any warning (regression)", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "shape",
        id: "s",
        geometry: "rect",
        size: { w: 10, h: 10 },
        cornerRadius: 2,
        fills: [{ kind: "solid", color: "#fff" }],
        strokes: [{ color: "#000", width: 1 }],
        visible: true,
        opacity: 0.5,
        rotation: 5,
        animate: { opacity: 1, transition: { duration: 100 } },
        bindAnimate: { opacity: "x.y" },
        metadata: { anything: true },
      }),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("authoring profiles are forwarded, never key-audited", () => {
    const { diagnostics } = collect(
      bundle({ kind: "frame", id: "f" }, { profiles: ["x-figma.authoring/1"] }),
    );
    expect(diagnostics).toHaveLength(0);
  });
});

describe("bundle-level accounting", () => {
  it("defaults / assets / i18n are not lowered → one warning each, nodeId <bundle>", () => {
    const { diagnostics } = collect(
      bundle(
        { kind: "frame", id: "f" },
        {
          defaults: { "score.home": SENTINEL },
          assets: { preload: [SENTINEL] },
          i18n: { default_locale: "fr" },
        },
      ),
    );
    for (const field of ["defaults", "assets", "i18n"]) {
      expect(diagnostics).toContainEqual(expect.objectContaining({ nodeId: "<bundle>", field }));
    }
    expect(JSON.stringify(diagnostics)).not.toContain(SENTINEL);
  });
});

describe("strict mode", () => {
  it("strict: true throws on the first unconsumed key", () => {
    expect(() =>
      compileBundle(bundle({ kind: "frame", id: "hero", effects: [] } as unknown as LSMLNode), {
        strict: true,
      }),
    ).toThrow(/hero.*effects|effects/);
  });

  it("the strict error names node + field but never the value (R9)", () => {
    try {
      compileBundle(
        bundle({ kind: "text", id: "t", style: { textShadow: SENTINEL } } as unknown as LSMLNode),
        { strict: true },
      );
      expect.unreachable("strict compile must throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('"t"');
      expect(msg).toContain("style.textShadow");
      expect(msg).not.toContain(SENTINEL);
    }
  });

  it("strict: true stays silent on a clean bundle", () => {
    expect(() =>
      compileBundle(bundle({ kind: "text", id: "t", style: { fontSize: 12 } }), { strict: true }),
    ).not.toThrow();
  });
});

describe("fixture suite — known spec'd-but-unsupported fields (RC#7)", () => {
  // Every fixture must yield ≥ 1 warning naming node.id + the field —
  // "zéro fixture en drop muet" (ADR 001 §6.7). These document the
  // CURRENT compiler gaps ; implementing one later turns its fixture
  // into a spurious-warning failure, forcing the sets to stay in sync.
  const fixtures: { name: string; node: Record<string, unknown>; field: string }[] = [
    {
      name: "frame effects (1.2 candidate)",
      node: { kind: "frame", id: "n", effects: [] },
      field: "effects",
    },
    {
      name: "node blendMode (1.2 candidate)",
      node: { kind: "frame", id: "n", blendMode: "multiply" },
      field: "blendMode",
    },
    {
      name: "node mask (1.2 candidate)",
      node: { kind: "shape", id: "n", geometry: "rect", mask: "ref" },
      field: "mask",
    },
    {
      name: "gradient transform carrier key",
      node: { kind: "shape", id: "n", geometry: "rect", fillTransform: [1, 0, 0, 1, 0, 0] },
      field: "fillTransform",
    },
    {
      name: "repeat limit",
      node: {
        kind: "repeat",
        id: "n",
        scope: "r",
        bind: { items: "i" },
        template: { kind: "text" },
        limit: 5,
      },
      field: "limit",
    },
    {
      name: "text style textShadow",
      node: { kind: "text", id: "n", style: { textShadow: "x" } },
      field: "style.textShadow",
    },
  ];

  it.each(fixtures)("$name → onWarn names node + field", ({ node, field }) => {
    const { diagnostics } = collect(bundle(node as unknown as LSMLNode));
    expect(diagnostics).toContainEqual(expect.objectContaining({ nodeId: "n", field }));
  });

  it.each(fixtures)("$name → strict throws", ({ node }) => {
    expect(() => compileBundle(bundle(node as unknown as LSMLNode), { strict: true })).toThrow();
  });
});
