// E2E — mount-play (LSML 1.1 §6 `animate.from`) must TWEEN in a real
// browser, not snap to the settled state.
//
// Regression context: the unit suite (tests/unit/mount-play.test.tsx) mocks
// framer-motion and can only prove the *props* handed to `motion.*` —
// `initial ≠ animate` + a transition object. It cannot prove the browser
// actually ramps. v0.3.0 shipped a mount-play that snapped on the real wire:
// when no per-prop `transitions[key]` entry resolves for the animated keys,
// `toFramer(undefined)` returned `{ duration: 0 }` and framer completed the
// initial→animate move in a single frame. This suite drives a real Chromium
// and asserts a mid-flight sample of computed opacity is strictly
// intermediate (a snap fails the assertion).
//
// Sampling: an init script installs a rAF loop that records
// `getComputedStyle(img).opacity` + transform from the instant the <img>
// enters the DOM — long before any Playwright round-trip could observe it.

import { test, expect, type Page } from "@playwright/test";
import { createScene, startServer, type ServerHandle } from "@lumencast/server";
import type { RenderBundle, RenderNode } from "../../src/render/bundle";

// 1×1 red PNG — keeps the bundle tiny and decode-instant.
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

interface Sample {
  t: number;
  opacity: number;
  transform: string;
}

function imageBundle(image: Partial<RenderNode>): RenderBundle {
  return {
    scene_version: "sha256:e2e-mount-play",
    root: {
      kind: "frame",
      id: "root",
      props: { width: 640, height: 360, background: "#ffffff" },
      children: [
        {
          kind: "image",
          id: "logo",
          props: { src: PNG_1PX, width: 200, height: 200, fit: "contain" },
          ...image,
        } as RenderNode,
      ],
    },
  };
}

async function bootServer(bundle: RenderBundle): Promise<ServerHandle> {
  const scene = createScene({
    sceneId: "e2e-mount-play",
    sceneVersion: bundle.scene_version,
    initialState: {},
  });
  return startServer({
    port: 0,
    scene,
    bundleProvider: () => bundle,
    authenticate: () => ({ role: "viewer" }),
  });
}

/** Install a rAF sampler that starts the moment an <img> appears. */
async function armSampler(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __samples: Array<{ t: number; opacity: number; transform: string }>;
    };
    w.__samples = [];
    const watch = () => {
      const img = document.querySelector("img");
      if (!img) {
        requestAnimationFrame(watch);
        return;
      }
      const t0 = performance.now();
      const loop = () => {
        const cs = getComputedStyle(img);
        w.__samples.push({
          t: performance.now() - t0,
          opacity: Number(cs.opacity),
          transform: cs.transform,
        });
        if (performance.now() - t0 < 2500) requestAnimationFrame(loop);
      };
      loop();
    };
    requestAnimationFrame(watch);
  });
}

async function collectSamples(page: Page): Promise<Sample[]> {
  // Wait until the sampling window is over (2.5s after the first img frame).
  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __samples?: Array<{ t: number }> }).__samples;
      return !!s && s.length > 3 && s[s.length - 1]!.t >= 2400;
    },
    undefined,
    { timeout: 15_000 },
  );
  return page.evaluate(() => (window as unknown as { __samples: Sample[] }).__samples);
}

function pageUrl(server: ServerHandle): string {
  const params = new URLSearchParams({ server: server.wsUrl, token: "any", mode: "broadcast" });
  return `/?${params.toString()}`;
}

test.describe("mount-play ramps in a real browser", () => {
  test("compiler-contract bundle (per-prop tween 1200ms) tweens — mid-flight opacity is intermediate", async ({
    page,
  }) => {
    const server = await bootServer(
      imageBundle({
        animate_initial: { opacity: 0, scale: 0.85 },
        transitions: {
          opacity: { kind: "tween", duration_ms: 1200, ease: "cubic-out" },
          scale: { kind: "tween", duration_ms: 1200, ease: "cubic-out" },
        },
      }),
    );
    try {
      await armSampler(page);
      await page.goto(pageUrl(server));
      const samples = await collectSamples(page);
      console.log(
        "[contract] samples:",
        samples
          .filter((_, i) => i % 5 === 0)
          .map((s) => `${s.t.toFixed(0)}ms:${s.opacity.toFixed(3)}`)
          .join(" "),
      );
      const intermediate = samples.filter((s) => s.opacity > 0.05 && s.opacity < 0.95);
      // A 1200ms tween sampled per-frame must yield many intermediate frames.
      expect(intermediate.length).toBeGreaterThan(3);
      // and it settles at 1.
      expect(samples[samples.length - 1]!.opacity).toBeCloseTo(1, 2);
    } finally {
      await server.close();
    }
  });

  test("served-wire shape (raw `transitions.transition` envelope) still tweens", async ({
    page,
  }) => {
    // Exact shape observed on the real wire (Orion render-bundle) : the
    // node-level `transitions` carries the raw LSML `animate` envelope —
    // a `transition` key with `{duration, easing}` — instead of the
    // contract's per-prop `{kind, duration_ms}` maps. The runtime never
    // looks up a "transition" key, so v0.3.0 resolved no transition for
    // the moved props and snapped. Post-fix the mount-play falls back to
    // the runtime default timing and visibly ramps. (Honouring the
    // envelope's 1200 ms is an Orion-side contract fix, tracked
    // separately — this test only pins "never snap".)
    const server = await bootServer(
      imageBundle({
        animate_initial: { opacity: 0, scale: 0.85 },
        transitions: {
          transition: { duration: 1200, easing: "ease-out" },
        } as unknown as RenderNode["transitions"],
      }),
    );
    try {
      await armSampler(page);
      await page.goto(pageUrl(server));
      const samples = await collectSamples(page);
      console.log(
        "[wire-shape] samples:",
        samples
          .filter((_, i) => i % 5 === 0)
          .map((s) => `${s.t.toFixed(0)}ms:${s.opacity.toFixed(3)}`)
          .join(" "),
      );
      const intermediate = samples.filter((s) => s.opacity > 0.05 && s.opacity < 0.95);
      expect(intermediate.length).toBeGreaterThan(3);
      expect(samples[samples.length - 1]!.opacity).toBeCloseTo(1, 2);
    } finally {
      await server.close();
    }
  });

  test("animate_initial WITHOUT per-prop transitions still tweens (runtime default timing)", async ({
    page,
  }) => {
    // This is the real-wire regression: the served node carried a flat
    // `animate_initial` but no per-prop `transitions` entry for the moved
    // keys → v0.3.0 snapped (duration 0).
    const server = await bootServer(
      imageBundle({
        animate_initial: { opacity: 0, scale: 0.85 },
      }),
    );
    try {
      await armSampler(page);
      await page.goto(pageUrl(server));
      const samples = await collectSamples(page);
      console.log(
        "[no-transitions] samples:",
        samples
          .filter((_, i) => i % 5 === 0)
          .map((s) => `${s.t.toFixed(0)}ms:${s.opacity.toFixed(3)}`)
          .join(" "),
      );
      const intermediate = samples.filter((s) => s.opacity > 0.05 && s.opacity < 0.95);
      expect(intermediate.length).toBeGreaterThan(3);
      expect(samples[samples.length - 1]!.opacity).toBeCloseTo(1, 2);
    } finally {
      await server.close();
    }
  });
});
