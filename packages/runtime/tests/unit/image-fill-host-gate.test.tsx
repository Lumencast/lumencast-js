// LSML 1.2 image-fill rendering + host/scheme enforcement at the render
// call-site (ADR 002 #F ; Bastion T1 / T2 / T4 / R9).
//
// This suite proves the RUNTIME ARM of the double-gate — the arm that was
// MISSING before #F : `isHostAllowed` existed (#C) but was called NOWHERE
// at render, so `assets.allowedHosts` was a declarative no-op (the latent
// 1.1 hole) and `image.tsx` placed any `src` straight onto `<img>`.
//
// Four things are proven on a real (happy-dom) DOM :
//   1. image-fill renders — frame `backgrounds[]` → `background-image:url`,
//      shape `fills[]` → an SVG <pattern><image>, with the closed-enum
//      objectFit mapped to background-size / preserveAspectRatio (T4) ;
//   2. T1/T2 — a `src` whose host is not in `assets.allowedHosts`, or whose
//      scheme is hostile (`javascript:` / `data:text/html` / `file:`), is
//      rejected : the asset is OMITTED (no URL in the DOM), never passthrough ;
//   3. deny-by-default — with NO allowlist, every remote host is rejected ;
//   4. R9 — the rejection diagnostic never echoes the URL ;
//   5. REGRESSION (the 1.1 hole) — `image.tsx` `<img src>` is now gated too.
//
// The gate is fed from `AllowedHostsProvider` (set by every render mode from
// `bundle.assets.allowedHosts`). A subtree rendered with NO provider sees
// `undefined` → deny-by-default, which is itself asserted.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import { AllowedHostsProvider } from "../../src/render/allowed-hosts.js";
import { addDiagnosticsHandler, type RenderDiagnostic } from "../../src/render/diagnostics.js";
import { createStore, type Store } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";

const CDN = "cdn.lumencast.dev";
const GOOD = `https://${CDN}/asset.png`;

let container: HTMLDivElement;
let root: Root;
let warnSpy: ReturnType<typeof vi.spyOn>;
let diagnostics: RenderDiagnostic[];
let unsub: () => void;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  diagnostics = [];
  unsub = addDiagnosticsHandler((d) => diagnostics.push(d));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  warnSpy.mockRestore();
  unsub();
});

async function render(
  node: RenderNode,
  store: Store,
  hosts: readonly string[] | undefined,
  withProvider = true,
): Promise<void> {
  await act(async () => {
    root.render(
      withProvider ? (
        <AllowedHostsProvider hosts={hosts}>
          <Tree node={node} store={store} />
        </AllowedHostsProvider>
      ) : (
        <Tree node={node} store={store} />
      ),
    );
  });
}

function html(): string {
  return container.innerHTML;
}

// ─── 1. image-fill renders (frame + shape) + objectFit (T4) ──────────

describe("image-fill renders with a valid host (ADR 002 §3.2)", () => {
  it("frame backgrounds[] → background-image:url(...) with the gated src", async () => {
    const node: RenderNode = {
      kind: "frame",
      props: {
        width: 100,
        height: 100,
        backgrounds: [{ kind: "image", src: GOOD, objectFit: "cover" }],
      },
    };
    await render(node, createStore(), [CDN]);
    const div = container.querySelector("div");
    const style = div?.getAttribute("style") ?? "";
    expect(style).toContain("background-image");
    expect(style).toContain(GOOD);
    // objectFit:cover → background-size: cover (T4 mapping, closed enum).
    expect(style).toContain("cover");
    expect(diagnostics).toEqual([]);
  });

  it("shape fills[] → an SVG <pattern><image href> with the gated src", async () => {
    const node: RenderNode = {
      kind: "shape",
      props: {
        geometry: "rect",
        width: 100,
        height: 100,
        fills: [{ kind: "image", src: GOOD, objectFit: "contain" }],
      },
    };
    await render(node, createStore(), [CDN]);
    const img = container.querySelector("pattern image");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("href")).toBe(GOOD);
    // contain → preserveAspectRatio "xMidYMid meet" (closed-enum mapping).
    expect(img?.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(diagnostics).toEqual([]);
  });

  it("T4 — an out-of-enum objectFit is dropped (diagnosed), the fill still renders", async () => {
    const node: RenderNode = {
      kind: "frame",
      props: {
        width: 100,
        height: 100,
        backgrounds: [{ kind: "image", src: GOOD, objectFit: "url(evil)" as never }],
      },
    };
    await render(node, createStore(), [CDN]);
    const style = container.querySelector("div")?.getAttribute("style") ?? "";
    // image still rendered (good host), but the bad fit never reaches CSS.
    expect(style).toContain("background-image");
    expect(style).not.toContain("url(evil)");
    expect(style).not.toContain("evil");
    // falls back to the default fit (cover).
    expect(style).toContain("cover");
    expect(diagnostics.some((d) => d.field.includes("objectFit"))).toBe(true);
  });
});

// ─── 2. T1/T2 — rejected src is OMITTED, never passthrough ───────────

describe("T1/T2 — image-fill src host/scheme gate (no passthrough)", () => {
  const evilHost = "https://evil.example/x.png";
  const hostile: Array<[string, string]> = [
    ["off-allowlist host", evilHost],
    ["javascript: scheme", "javascript:alert(1)//cdn.lumencast.dev"],
    ["data:text/html", "data:text/html,<script>alert(1)</script>"],
    ["file: scheme", "file:///etc/passwd"],
    ["userinfo @-trick", `https://${CDN}@evil.example/x.png`],
  ];

  it.each(hostile)(
    "frame backgrounds[] — %s → image omitted, no URL in the DOM",
    async (_label, src) => {
      const node: RenderNode = {
        kind: "frame",
        props: { width: 100, height: 100, backgrounds: [{ kind: "image", src }] },
      };
      await render(node, createStore(), [CDN]);
      const style = container.querySelector("div")?.getAttribute("style") ?? "";
      expect(style).not.toContain("background-image");
      expect(html()).not.toContain(src);
      expect(html()).not.toContain("evil");
      expect(html()).not.toContain("javascript:");
      // a diagnostic fired for the rejected src.
      expect(diagnostics.some((d) => d.field === "frame.backgrounds.src")).toBe(true);
    },
  );

  it.each(hostile)(
    "shape fills[] — %s → no <image> emitted, no URL in the DOM",
    async (_label, src) => {
      const node: RenderNode = {
        kind: "shape",
        props: { geometry: "rect", width: 100, height: 100, fills: [{ kind: "image", src }] },
      };
      await render(node, createStore(), [CDN]);
      expect(container.querySelector("pattern image")).toBeNull();
      expect(html()).not.toContain(src);
      expect(diagnostics.some((d) => d.field === "shape.fills.src")).toBe(true);
    },
  );
});

// ─── 3. deny-by-default (no allowlist) ───────────────────────────────

describe("deny-by-default — no allowlist rejects every remote host", () => {
  it("frame image-fill with allowlist absent → omitted", async () => {
    const node: RenderNode = {
      kind: "frame",
      props: { width: 100, height: 100, backgrounds: [{ kind: "image", src: GOOD }] },
    };
    await render(node, createStore(), undefined);
    const style = container.querySelector("div")?.getAttribute("style") ?? "";
    expect(style).not.toContain("background-image");
    expect(html()).not.toContain(GOOD);
  });

  it("NO provider at all → deny-by-default (image-fill omitted)", async () => {
    const node: RenderNode = {
      kind: "frame",
      props: { width: 100, height: 100, backgrounds: [{ kind: "image", src: GOOD }] },
    };
    await render(node, createStore(), undefined, /* withProvider */ false);
    const style = container.querySelector("div")?.getAttribute("style") ?? "";
    expect(style).not.toContain("background-image");
  });

  it("empty allowlist → omitted", async () => {
    const node: RenderNode = {
      kind: "shape",
      props: { geometry: "rect", width: 100, height: 100, fills: [{ kind: "image", src: GOOD }] },
    };
    await render(node, createStore(), []);
    expect(container.querySelector("pattern image")).toBeNull();
  });
});

// ─── 4. R9 — the diagnostic never echoes the URL ─────────────────────

describe("R9 — rejection diagnostic carries no URL", () => {
  it("a secret-bearing rejected URL never appears in any diagnostic", async () => {
    const secret = "https://secret-token-9f3a.evil.example/leak.png";
    const node: RenderNode = {
      kind: "frame",
      props: { width: 100, height: 100, backgrounds: [{ kind: "image", src: secret }] },
    };
    await render(node, createStore(), [CDN]);
    expect(diagnostics.length).toBeGreaterThan(0);
    const dump = JSON.stringify(diagnostics);
    expect(dump).not.toContain("secret-token-9f3a");
    expect(dump).not.toContain("evil.example");
    expect(dump).not.toContain("leak.png");
    // and the field name IS present (so the drop is observable).
    expect(diagnostics.some((d) => d.field === "frame.backgrounds.src")).toBe(true);
  });
});

// ─── 5. REGRESSION — the latent 1.1 hole : image.tsx is now gated ────

describe("REGRESSION (1.1 hole) — image primitive `src` is host-gated", () => {
  it("an allowed https host renders the <img>", async () => {
    const node: RenderNode = {
      kind: "image",
      props: { src: GOOD, alt: "logo" },
    };
    await render(node, createStore(), [CDN]);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(GOOD);
    expect(diagnostics).toEqual([]);
  });

  it("an off-allowlist host → <img> OMITTED (was a passthrough before #F)", async () => {
    const evil = "https://evil.example/track.png";
    const node: RenderNode = { kind: "image", props: { src: evil, alt: "x" } };
    await render(node, createStore(), [CDN]);
    expect(container.querySelector("img")).toBeNull();
    expect(html()).not.toContain(evil);
    expect(diagnostics.some((d) => d.field === "image.src")).toBe(true);
  });

  it("deny-by-default — image primitive with no allowlist → omitted", async () => {
    const node: RenderNode = { kind: "image", props: { src: GOOD, alt: "x" } };
    await render(node, createStore(), undefined);
    expect(container.querySelector("img")).toBeNull();
  });

  it("hostile scheme on the image primitive → omitted, no URL in DOM", async () => {
    const node: RenderNode = {
      kind: "image",
      props: { src: "javascript:alert(1)", alt: "x" },
    };
    await render(node, createStore(), [CDN]);
    expect(container.querySelector("img")).toBeNull();
    expect(html()).not.toContain("javascript:");
  });

  it("live LSDP delta — a hostile src arriving on the wire is gated", async () => {
    const store = createStore();
    store.set("logo.src", GOOD);
    const node: RenderNode = {
      kind: "image",
      props: { alt: "x" },
      bindings: { src: "logo.src" },
    };
    await render(node, store, [CDN]);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(GOOD);

    // wire pushes an off-allowlist host : the <img> must drop (the compiler
    // never saw this delta — this is exactly why the runtime arm exists).
    await act(async () => store.set("logo.src", "https://evil.example/x.png"));
    expect(container.querySelector("img")).toBeNull();
    expect(html()).not.toContain("evil.example");

    // a later valid delta recovers.
    await act(async () => store.set("logo.src", GOOD));
    expect(container.querySelector("img")?.getAttribute("src")).toBe(GOOD);
  });
});
