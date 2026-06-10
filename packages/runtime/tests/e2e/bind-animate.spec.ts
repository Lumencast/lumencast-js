// E2E — bindAnimate (LSML 1.1 §6.3, ADR 001 §3.3 / RC#6 / RC#13, issues #33 + #42).
//
// Proven against a real Chromium + @lumencast/server :
//   1. RC#6  — a delta on a bound leaf animates opacity + translate
//      CONTINUOUSLY on the SAME DOM node (no remount) ;
//   2. RC#6  — a spring retarget mid-course does not snap (velocity
//      carry : no teleport between consecutive frames) ;
//   3. RC#6  — a bound colour interpolates in sRGB (mid-flight sample
//      is strictly intermediate channel-wise) ;
//   4. RC#13 — a ~1 kHz delta storm on bound leaves : the main thread
//      keeps framing (p95 inter-frame gap ≤ 50 ms = the delta→DOM
//      budget under coalescing), ZERO layout events (layout-shift
//      entries), and the DOM settles on the last sent target ;
//   5. issue #42 (R8 runtime) — hostile filter values pushed live are
//      clamped/rejected, never applied raw to the DOM.

import { test, expect, type Page } from "@playwright/test";
import { createScene, startServer, type ServerHandle } from "@lumencast/server";
import type { RenderBundle, RenderNode } from "../../src/render/bundle";

function gaugeBundle(nodes: RenderNode[]): RenderBundle {
  return {
    scene_version: "sha256:e2e-bind-animate",
    root: {
      kind: "frame",
      id: "root",
      props: { width: 960, height: 540, background: "#ffffff" },
      children: nodes,
    },
  };
}

async function bootServer(
  bundle: RenderBundle,
  initialState: Record<string, unknown>,
): Promise<{ server: ServerHandle; scene: ReturnType<typeof createScene> }> {
  const scene = createScene({
    sceneId: "e2e-bind-animate",
    sceneVersion: bundle.scene_version,
    initialState: initialState as Record<string, never>,
  });
  const server = await startServer({
    port: 0,
    scene,
    bundleProvider: () => bundle,
    authenticate: () => ({ role: "viewer" }),
  });
  return { server, scene };
}

function pageUrl(server: ServerHandle): string {
  const params = new URLSearchParams({ server: server.wsUrl, token: "any", mode: "broadcast" });
  return `/?${params.toString()}`;
}

async function waitLive(page: Page): Promise<void> {
  await expect(page.locator("#scene")).toHaveAttribute("data-status", "live", {
    timeout: 10_000,
  });
}

interface Sample {
  t: number;
  opacity: number;
  x: number;
}

/** rAF sampler on the bindAnimate wrapper of `id` — computed opacity +
 *  translateX (transform matrix m41), started from the page side. */
async function startSampler(page: Page, id: string, windowMs: number): Promise<void> {
  await page.evaluate(
    ({ id, windowMs }) => {
      const w = window as unknown as {
        __samples: Array<{ t: number; opacity: number; x: number }>;
      };
      w.__samples = [];
      const el = document.querySelector(`[data-lumencast-bind-animate="${id}"]`) as HTMLElement;
      const t0 = performance.now();
      const loop = (): void => {
        const cs = getComputedStyle(el);
        let x = 0;
        if (cs.transform && cs.transform !== "none") {
          const m = new DOMMatrixReadOnly(cs.transform);
          x = m.m41;
        }
        w.__samples.push({ t: performance.now() - t0, opacity: Number(cs.opacity), x });
        if (performance.now() - t0 < windowMs) requestAnimationFrame(loop);
      };
      loop();
    },
    { id, windowMs },
  );
}

async function collectSamples(page: Page, windowMs: number): Promise<Sample[]> {
  await page.waitForFunction(
    (windowMs) => {
      const s = (window as unknown as { __samples?: Array<{ t: number }> }).__samples;
      return !!s && s.length > 3 && s[s.length - 1]!.t >= windowMs - 100;
    },
    windowMs,
    { timeout: windowMs + 15_000 },
  );
  return page.evaluate(() => (window as unknown as { __samples: Sample[] }).__samples);
}

// ─── 1. RC#6 — continuous animation, no remount ──────────────────────

test("delta on a bound leaf animates opacity+translate continuously on the SAME DOM node", async ({
  page,
}) => {
  const { server, scene } = await bootServer(
    gaugeBundle([
      {
        kind: "frame",
        id: "gauge",
        props: { width: 200, height: 40, background: "#22d3ee" },
        animateBindings: { opacity: "g.o", "transform.translate": "g.pos" },
        transitions: {
          opacity: { kind: "tween", duration_ms: 900, ease: "linear" },
          x: { kind: "tween", duration_ms: 900, ease: "linear" },
          y: { kind: "tween", duration_ms: 900, ease: "linear" },
        },
      },
    ]),
    { "g.o": 1, "g.pos": [0, 0] },
  );
  try {
    await page.goto(pageUrl(server));
    await waitLive(page);
    // NB : the wrapper itself has a zero-size content box (its frame
    // child is absolutely positioned) — assert attachment, not
    // visibility ; the computed styles are what matters.
    const wrapper = page.locator('[data-lumencast-bind-animate="gauge"]');
    await wrapper.waitFor({ state: "attached" });

    // Mark the DOM node — a remount would lose the expando.
    await wrapper.evaluate((el) => {
      (el as unknown as { __marker: number }).__marker = 42;
    });

    await startSampler(page, "gauge", 1600);
    scene.update({ "g.o": 0.2, "g.pos": [300, 0] });
    const samples = await collectSamples(page, 1600);

    // Continuous : many strictly-intermediate frames on both channels.
    const midOpacity = samples.filter((s) => s.opacity > 0.25 && s.opacity < 0.95);
    const midX = samples.filter((s) => s.x > 10 && s.x < 290);
    expect(midOpacity.length).toBeGreaterThan(5);
    expect(midX.length).toBeGreaterThan(5);
    // Settled at the live targets.
    const last = samples[samples.length - 1]!;
    expect(last.opacity).toBeCloseTo(0.2, 1);
    expect(Math.abs(last.x - 300)).toBeLessThan(2);

    // Same node, no remount (RC#6 identity).
    const marker = await wrapper.evaluate(
      (el) => (el as unknown as { __marker?: number }).__marker,
    );
    expect(marker).toBe(42);
  } finally {
    await server.close();
  }
});

// ─── 2. RC#6 — spring retarget mid-course : no snap ──────────────────

test("spring retarget mid-course carries velocity — no frame-to-frame teleport", async ({
  page,
}) => {
  const { server, scene } = await bootServer(
    gaugeBundle([
      {
        kind: "frame",
        id: "spring",
        props: { width: 100, height: 100, background: "#f97316" },
        animateBindings: { "transform.translate": "s.pos" },
        transitions: {
          x: { kind: "spring", stiffness: 110, damping: 16, mass: 1 },
          y: { kind: "spring", stiffness: 110, damping: 16, mass: 1 },
        },
      },
    ]),
    { "s.pos": [0, 0] },
  );
  try {
    await page.goto(pageUrl(server));
    await waitLive(page);
    await page.locator('[data-lumencast-bind-animate="spring"]').waitFor({ state: "attached" });

    await startSampler(page, "spring", 2500);
    scene.update({ "s.pos": [400, 0] });
    await page.waitForTimeout(250); // mid-course
    scene.update({ "s.pos": [0, 0] }); // retarget back
    const samples = await collectSamples(page, 2500);

    // The element actually moved out…
    const maxX = Math.max(...samples.map((s) => s.x));
    expect(maxX).toBeGreaterThan(50);
    // …and never teleported : consecutive frames are continuous. A snap
    // (remount or velocity reset to a fresh keyframe) shows up as a
    // jump of the order of the remaining distance.
    let maxJump = 0;
    for (let i = 1; i < samples.length; i++) {
      const dt = samples[i]!.t - samples[i - 1]!.t;
      if (dt > 50) continue; // ignore long-frame outliers
      maxJump = Math.max(maxJump, Math.abs(samples[i]!.x - samples[i - 1]!.x));
    }
    expect(maxJump).toBeLessThan(80);
    // Settles back at the final live target.
    expect(Math.abs(samples[samples.length - 1]!.x)).toBeLessThan(2);
  } finally {
    await server.close();
  }
});

// ─── 3. RC#6 — bound colour interpolates in sRGB ─────────────────────

test("bound colour interpolates in sRGB (mid-flight sample strictly intermediate)", async ({
  page,
}) => {
  const { server, scene } = await bootServer(
    gaugeBundle([
      {
        kind: "text",
        id: "label",
        props: { size: 48, weight: 700, value: "GAUGE" },
        animateBindings: { "style.color": "c.v" },
        transitions: { colour: { kind: "tween", duration_ms: 1200, ease: "linear" } },
      },
    ]),
    { "c.v": "#ff0000" },
  );
  try {
    await page.goto(pageUrl(server));
    await waitLive(page);
    const span = page.locator("span", { hasText: "GAUGE" });
    await expect(span).toBeVisible();
    // Chrome serialises computed colours with alpha 1 as rgb().
    await expect(span).toHaveCSS("color", "rgb(255, 0, 0)");

    await page.evaluate(() => {
      const w = window as unknown as { __colors: string[] };
      w.__colors = [];
      const el = document.querySelector("span")!;
      const t0 = performance.now();
      const loop = (): void => {
        w.__colors.push(getComputedStyle(el).color);
        if (performance.now() - t0 < 2000) requestAnimationFrame(loop);
      };
      loop();
    });
    scene.update({ "c.v": "#0000ff" });
    await page.waitForTimeout(2200);
    const colors = await page.evaluate(
      () => (window as unknown as { __colors: string[] }).__colors,
    );

    const parsed = colors
      .map((c) => /rgba?\((\d+), (\d+), (\d+)/.exec(c))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) }));
    // sRGB component-wise : red falls while blue rises, green stays 0.
    const intermediate = parsed.filter(
      (c) => c.r > 20 && c.r < 235 && c.b > 20 && c.b < 235 && c.g === 0,
    );
    expect(intermediate.length).toBeGreaterThan(5);
    const last = parsed[parsed.length - 1]!;
    expect(last).toEqual({ r: 0, g: 0, b: 255 });
  } finally {
    await server.close();
  }
});

// ─── 4. RC#13 — ~1 kHz storm : budget held, zero layout events ───────

test("~1 kHz delta storm on bound leaves : p95 frame gap ≤ 50 ms, 0 layout events, settles", async ({
  page,
}) => {
  const N = 6;
  const nodes: RenderNode[] = [];
  const initial: Record<string, unknown> = {};
  for (let i = 0; i < N; i++) {
    initial[`n${i}.o`] = 1;
    initial[`n${i}.pos`] = [0, i * 60];
    nodes.push({
      kind: "frame",
      id: `bar${i}`,
      props: { width: 200, height: 40, background: "#22d3ee" },
      animateBindings: { opacity: `n${i}.o`, "transform.translate": `n${i}.pos` },
      transitions: {
        opacity: { kind: "spring", stiffness: 170, damping: 26, mass: 1 },
        x: { kind: "spring", stiffness: 170, damping: 26, mass: 1 },
        y: { kind: "spring", stiffness: 170, damping: 26, mass: 1 },
      },
    });
  }
  const { server, scene } = await bootServer(gaugeBundle(nodes), initial);
  try {
    await page.goto(pageUrl(server));
    await waitLive(page);
    await page.locator('[data-lumencast-bind-animate="bar0"]').waitFor({ state: "attached" });

    // Arm metrics : rAF gap recorder + layout-shift observer.
    await page.evaluate(() => {
      const w = window as unknown as { __gaps: number[]; __layoutEvents: number };
      w.__gaps = [];
      w.__layoutEvents = 0;
      new PerformanceObserver((list) => {
        w.__layoutEvents += list.getEntries().length;
      }).observe({ type: "layout-shift" });
      let last = performance.now();
      const loop = (): void => {
        const now = performance.now();
        w.__gaps.push(now - last);
        last = now;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });

    // ≥ 1 kHz for 1.5 s, self-paced : each 10 ms tick tops the sent
    // count up to elapsed × 1.05/ms (compensates interval drift).
    // Round-robin over the N bound leaf pairs ; every update is a real
    // LSDP delta frame.
    let sent = 0;
    let lastOpacity = 1;
    let lastX = 0;
    await new Promise<void>((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const target = Math.ceil((Date.now() - t0) * 1.05);
        while (sent < target) {
          const i = sent % N;
          lastOpacity = 0.2 + 0.8 * Math.abs(Math.sin(sent / 50));
          lastX = Math.round(300 * Math.abs(Math.sin(sent / 80)));
          scene.update({
            [`n${i}.o`]: lastOpacity,
            [`n${i}.pos`]: [lastX, i * 60],
          });
          sent++;
        }
      }, 10);
      setTimeout(() => {
        clearInterval(iv);
        resolve();
      }, 1500);
    });
    expect(sent).toBeGreaterThanOrEqual(1500); // ≥ 1 kHz sustained over 1.5 s

    // Grace for the springs to settle, then read the metrics.
    await page.waitForTimeout(1500);
    const { gaps, layoutEvents } = await page.evaluate(() => {
      const w = window as unknown as { __gaps: number[]; __layoutEvents: number };
      return { gaps: w.__gaps, layoutEvents: w.__layoutEvents };
    });

    // 0 layout events on the animation hot path (RC#13 / CLAUDE.md budget).
    expect(layoutEvents).toBe(0);

    // p95 inter-frame gap ≤ 50 ms : under coalescing the retarget work
    // is bounded per frame, so the main thread keeps framing within the
    // delta→DOM budget even at 1 kHz input.
    const sorted = [...gaps].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    console.log(
      `[1kHz] deltas sent: ${sent}, frames: ${gaps.length}, p95 gap: ${p95.toFixed(1)}ms, layout events: ${layoutEvents}`,
    );
    expect(p95).toBeLessThanOrEqual(50);

    // The last sent target actually landed (continuous binding did not
    // saturate or drop the tail).
    const lastBar = (sent - 1) % N;
    await page.waitForFunction(
      ({ id, x }) => {
        const el = document.querySelector(`[data-lumencast-bind-animate="${id}"]`)!;
        const cs = getComputedStyle(el);
        const m = new DOMMatrixReadOnly(cs.transform === "none" ? "" : cs.transform);
        return Math.abs(m.m41 - x) < 2;
      },
      { id: `bar${lastBar}`, x: lastX },
      { timeout: 5_000 },
    );
  } finally {
    await server.close();
  }
});

// ─── 5. issue #42 — hostile live filter deltas (R8 runtime half) ─────

test("hostile filter deltas are clamped/rejected — never applied raw to the DOM", async ({
  page,
}) => {
  const { server, scene } = await bootServer(
    gaugeBundle([
      {
        kind: "frame",
        id: "fx",
        props: { width: 100, height: 100, background: "#22d3ee" },
        animateBindings: { "filter.blur": "f.b", "filter.brightness": "f.br" },
        transitions: { filter: { kind: "none" } },
      },
    ]),
    { "f.b": 2, "f.br": 1 },
  );
  try {
    await page.goto(pageUrl(server));
    await waitLive(page);
    const el = page.locator('[data-lumencast-bind-animate="fx"]');
    await el.waitFor({ state: "attached" });
    await expect(el).toHaveCSS("filter", "blur(2px) brightness(1)");

    // Giant blur → clamped to the 100px cap, never the raw value.
    scene.update({ "f.b": 1e9 });
    await expect(el).toHaveCSS("filter", "blur(100px) brightness(1)", { timeout: 3_000 });

    // Extreme brightness → clamped to 4.
    scene.update({ "f.br": 4000 });
    await expect(el).toHaveCSS("filter", "blur(100px) brightness(4)", { timeout: 3_000 });

    // Negative / type-confused deltas → rejected, last good value kept.
    scene.update({ "f.b": -50 });
    scene.update({ "f.br": "url(javascript:alert(1))" });
    scene.update({ "f.b": [9999] });
    await page.waitForTimeout(300);
    await expect(el).toHaveCSS("filter", "blur(100px) brightness(4)");

    // The raw values never reached any inline style anywhere.
    const styles = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[style]")].map((e) => e.getAttribute("style")),
    );
    const all = styles.join("\n");
    expect(all).not.toContain("1e9");
    expect(all).not.toContain("1000000000");
    expect(all).not.toContain("url(");
    expect(all).not.toContain("9999");
  } finally {
    await server.close();
  }
});
