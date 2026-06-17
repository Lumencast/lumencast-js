// Compiler arm of the image-fill host/scheme double-gate (ADR 002 #F ;
// Bastion T1 / T2 / T6 / R9).
//
// The compiler lowers `assets.allowedHosts` into a per-bundle decision and
// gates every image-fill `src` AT LOWERING — the arm that catches a hostile
// `src` baked into the authored bundle before it ever ships. (The runtime
// re-gates because live LSDP deltas bypass the compiler ; that arm is proven
// in the runtime suite.) A rejected `src` drops the WHOLE image-fill (never
// a passthrough URL) with an R9-clean diagnostic, and `assets` is forwarded
// verbatim into the RenderBundle so the runtime has the allowlist (T6).

import { describe, expect, it } from "vitest";
import { compileBundle, ZERO_HASH } from "../src/index.js";
import type { LSMLBundle, LSMLNode } from "../src/lsml-types.js";

const CDN = "cdn.lumencast.dev";

function compileWith(
  layout: LSMLNode,
  allowedHosts: string[] | undefined,
): { warns: string[]; bundle: ReturnType<typeof compileBundle> } {
  const warns: string[] = [];
  const lsml: LSMLBundle = {
    lsml: "1.2",
    scene_id: "t",
    scene_version: ZERO_HASH,
    layout,
    ...(allowedHosts !== undefined ? { assets: { allowedHosts } } : {}),
  };
  const bundle = compileBundle(lsml, { onWarn: (m) => warns.push(m) });
  return { warns, bundle };
}

function fillsOf(bundle: ReturnType<typeof compileBundle>): Array<Record<string, unknown>> {
  return (bundle.root.props?.["fills"] as Array<Record<string, unknown>>) ?? [];
}

describe("compiler image-fill host gate — allowed src survives (T1/T2)", () => {
  it("an https src on an allowed host is lowered intact", () => {
    const { warns, bundle } = compileWith(
      {
        kind: "shape",
        geometry: "rect",
        fills: [{ kind: "image", src: `https://${CDN}/a.png`, objectFit: "cover" }],
      },
      [CDN],
    );
    const fills = fillsOf(bundle);
    expect(fills).toHaveLength(1);
    expect(fills[0]!["src"]).toBe(`https://${CDN}/a.png`);
    expect(fills[0]!["objectFit"]).toBe("cover");
    expect(warns).toEqual([]);
  });

  it("forwards assets verbatim so the runtime can re-gate (T6)", () => {
    const { bundle } = compileWith({ kind: "frame" }, [CDN]);
    expect(bundle.assets).toEqual({ allowedHosts: [CDN] });
  });
});

describe("compiler image-fill host gate — hostile src dropped (no passthrough)", () => {
  const hostile: Array<[string, string]> = [
    ["off-allowlist host", "https://evil.example/x.png"],
    ["javascript: scheme", "javascript:alert(1)"],
    ["data:text/html", "data:text/html,<script>alert(1)</script>"],
    ["file: scheme", "file:///etc/passwd"],
    ["userinfo @-trick", `https://${CDN}@evil.example/x.png`],
    ["protocol-relative", "//evil.example/x.png"],
  ];

  it.each(hostile)("shape fills[] — %s → fill dropped, one warning", (_label, src) => {
    const { warns, bundle } = compileWith(
      { kind: "shape", geometry: "rect", fills: [{ kind: "image", src }] },
      [CDN],
    );
    expect(fillsOf(bundle)).toEqual([]);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("src");
    // R9 — the diagnostic never echoes the URL.
    expect(warns[0]).not.toContain(src);
    expect(warns[0]).not.toContain("evil");
  });

  it("deny-by-default — no allowlist drops a remote image-fill", () => {
    const { warns, bundle } = compileWith(
      { kind: "shape", geometry: "rect", fills: [{ kind: "image", src: `https://${CDN}/a.png` }] },
      undefined,
    );
    expect(fillsOf(bundle)).toEqual([]);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("src");
  });

  it("a hostile image-fill drops but a sibling solid fill survives", () => {
    const { bundle } = compileWith(
      {
        kind: "shape",
        geometry: "rect",
        fills: [
          { kind: "image", src: "https://evil.example/x.png" },
          { kind: "solid", color: "#ff0000" },
        ],
      },
      [CDN],
    );
    const fills = fillsOf(bundle);
    expect(fills).toHaveLength(1);
    expect(fills[0]!["kind"]).toBe("solid");
  });

  it("frame backgrounds[] are gated the same way", () => {
    const { warns, bundle } = compileWith(
      { kind: "frame", backgrounds: [{ kind: "image", src: "https://evil.example/bg.png" }] },
      [CDN],
    );
    const bgs = (bundle.root.props?.["backgrounds"] as unknown[]) ?? [];
    expect(bgs).toEqual([]);
    expect(warns).toHaveLength(1);
  });
});
