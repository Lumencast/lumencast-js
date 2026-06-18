// Zero-loss render harness — ADR 002 #J / RC#10.
//
// Capstone of the campaign: turns "we believe 817:3 is zero-loss" into a
// measured, CI-deterministic proof. The round-trip exercised here is:
//
//   817:3 (Figma) → mapper → LSML 1.2 (committed fixture cover-817-3.lsml.json)
//     → @lumencast/compiler → @lumencast/runtime (production BroadcastMode render)
//     → headless Chromium screenshot → SSIM.
//
// What this spec proves DETERMINISTICALLY in CI:
//   1. Render determinism — the same bundle screenshots bit-identically twice
//      (SSIM self-match = 1.0). Validates both the render path and the SSIM
//      metric have a true 1.0 ceiling.
//   2. Every promoted 1.2 family (blend / mask / gradient / image-fill) paints
//      a distinct, non-black, structured region — i.e. it RENDERED, was not
//      dropped or flattened to nothing.
//   3. Full-reference SSIM vs the committed Figma ground-truth PNG is MEASURED
//      and reported (the round-trip scaffold). It is NOT gated at 1.0 here —
//      see the honesty note below — but the harness, the reference, and the
//      metric are all in place for the real-asset / live run.
//
// HONESTY ON SCOPE (RC#10 SSIM = 1.0): a byte-true 1.0 against the Figma
// reference requires the *real* asset bitmaps (Ruby20 photo, 3d renders, the
// ~190 texture tiles), the exact brand fonts, and the full node tree — the
// heavy / live path. This deterministic CI fixture substitutes solid-colour
// swatches for the bitmaps (the structure is faithful; the pixels are not the
// photo). So the reference-SSIM is reported as a scaffold metric, and the GOLD
// proof remains a live render (Zab live-Twitch doctrine). The structural
// "0 rasterised node" invariant — the OTHER half of RC#10 — is proven
// exhaustively and deterministically in `tests/unit/zero-loss-structural.test.ts`.
//
// Pixel work runs INSIDE the page (native ImageData), never marshalling the
// 8M-element RGBA arrays over the CDP bridge — `ssim.ts` is the canonical Node
// implementation (unit-tested in tests/unit/ssim.test.ts); the in-page copy
// below mirrors it byte-for-byte.

import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGE = "#scene";
const W = 1920;
const H = 1080;
const HARNESS_URL = "/tests/e2e/zero-loss/harness.html";

/** Read the committed reference PNG as a base64 data URI for in-browser decode. */
function refDataUri(): string {
  const buf = readFileSync(resolve(__dirname, "fixtures/ref-817-3.png"));
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function gotoHarness(page: Page): Promise<void> {
  await page.goto(HARNESS_URL);
  await page.waitForFunction(
    () => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(100); // settle one frame
}

async function screenshotDataUri(page: Page): Promise<string> {
  const buf = await page.locator(STAGE).screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  return `data:image/png;base64,${buf.toString("base64")}`;
}

/**
 * Compute SSIM between two PNG data URIs entirely in the page (native
 * ImageData — no large-array bridge transfer). Mirrors `ssim.ts`.
 */
async function ssimInPage(
  page: Page,
  aUri: string,
  bUri: string,
  w: number,
  h: number,
): Promise<{ score: number; windows: number }> {
  return page.evaluate(
    async ({ a, b, width, height }) => {
      async function rgba(uri: string): Promise<Uint8ClampedArray> {
        const img = new Image();
        img.src = uri;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        return ctx.getImageData(0, 0, width, height).data;
      }
      const pa = await rgba(a);
      const pb = await rgba(b);

      const C1 = (0.01 * 255) ** 2;
      const C2 = (0.03 * 255) ** 2;
      const WIN = 8;
      const luma = (p: Uint8ClampedArray, i: number) =>
        0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];

      let scoreSum = 0;
      let windows = 0;
      for (let wy = 0; wy + WIN <= height; wy += WIN) {
        for (let wx = 0; wx + WIN <= width; wx += WIN) {
          let sA = 0,
            sB = 0,
            sAA = 0,
            sBB = 0,
            sAB = 0;
          const n = WIN * WIN;
          for (let y = 0; y < WIN; y++) {
            for (let x = 0; x < WIN; x++) {
              const idx = ((wy + y) * width + (wx + x)) * 4;
              const la = luma(pa, idx);
              const lb = luma(pb, idx);
              sA += la;
              sB += lb;
              sAA += la * la;
              sBB += lb * lb;
              sAB += la * lb;
            }
          }
          const mA = sA / n;
          const mB = sB / n;
          const vA = sAA / n - mA * mA;
          const vB = sBB / n - mB * mB;
          const cov = sAB / n - mA * mB;
          const num = (2 * mA * mB + C1) * (2 * cov + C2);
          const den = (mA * mA + mB * mB + C1) * (vA + vB + C2);
          scoreSum += num / den;
          windows += 1;
        }
      }
      return { score: windows === 0 ? 1 : scoreSum / windows, windows };
    },
    { a: aUri, b: bUri, width: w, height: h },
  );
}

/**
 * Whole-frame paint statistics computed in the page. Location-independent
 * (the mapper's relative-positioning lands nodes at compiled coordinates that
 * differ from the raw Figma x/y, so we assert on WHAT painted, not WHERE):
 *   - `nonBlackFraction` — share of pixels with luminance > 8 (something rendered).
 *   - `distinctColours`   — count of distinct 5-bit-quantised RGB buckets among
 *     non-black pixels (each promoted family contributes its own swatch / the
 *     gradient contributes a ramp → many buckets).
 *   - `maxLocalStd`       — the largest per-8×8-tile luminance std-dev (a flat
 *     swatch ≈ 0; a gradient ramp is high → proves the gradient rendered as a
 *     ramp, not a flat fill).
 */
async function paintStats(
  page: Page,
  uri: string,
  w: number,
  h: number,
): Promise<{ nonBlackFraction: number; distinctColours: number; maxLocalStd: number }> {
  return page.evaluate(
    async ({ u, width, height }) => {
      const img = new Image();
      img.src = u;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, width, height);
      const px = ctx.getImageData(0, 0, width, height).data;

      const buckets = new Set<number>();
      let nonBlack = 0;
      const total = width * height;
      for (let i = 0; i < px.length; i += 4) {
        const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (l > 8) {
          nonBlack++;
          // 5-bit-per-channel quantisation.
          buckets.add(((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3));
        }
      }

      // Max local luminance std-dev over a coarse 8×8 grid stride (cheap scan).
      let maxStd = 0;
      const WIN = 8;
      for (let wy = 0; wy + WIN <= height; wy += WIN * 4) {
        for (let wx = 0; wx + WIN <= width; wx += WIN * 4) {
          let s = 0,
            ss = 0;
          for (let y = 0; y < WIN; y++) {
            for (let x = 0; x < WIN; x++) {
              const idx = ((wy + y) * width + (wx + x)) * 4;
              const l = 0.299 * px[idx] + 0.587 * px[idx + 1] + 0.114 * px[idx + 2];
              s += l;
              ss += l * l;
            }
          }
          const n = WIN * WIN;
          const std = Math.sqrt(Math.max(0, ss / n - (s / n) ** 2));
          if (std > maxStd) maxStd = std;
        }
      }

      return {
        nonBlackFraction: nonBlack / total,
        distinctColours: buckets.size,
        maxLocalStd: maxStd,
      };
    },
    { u: uri, width: w, height: h },
  );
}

test.describe("zero-loss harness — 817:3 round-trip render (RC#10)", () => {
  test("renders deterministically — SSIM self-match is 1.0", async ({ page }) => {
    await gotoHarness(page);
    const a = await screenshotDataUri(page);
    await gotoHarness(page);
    const b = await screenshotDataUri(page);
    const { score, windows } = await ssimInPage(page, a, b, W, H);
    expect(windows).toBeGreaterThan(0);
    // Render path + metric have a true 1.0 ceiling.
    expect(score).toBeCloseTo(1, 5);
  });

  test("the promoted 1.2 families paint distinct, non-black content (incl. a gradient ramp)", async ({
    page,
  }) => {
    await gotoHarness(page);
    const shot = await screenshotDataUri(page);
    const stats = await paintStats(page, shot, W, H);

    // Something rendered across a meaningful share of the 1920×1080 frame
    // (the four families + gradient occupy a large fraction).
    expect(stats.nonBlackFraction, "frame is essentially black → nothing rendered").toBeGreaterThan(
      0.05,
    );

    // Many distinct colours: the swatch images (ruby20 / render3d / wavy) are a
    // handful of flat buckets, but the WP gradient is a smooth ramp from
    // #ff3366 → #1a1a80 that contributes DOZENS of 5-bit buckets on its own. A
    // world where the gradient rendered as a flat fill (or was dropped) would
    // collapse the total to a single-digit count — so this is the primary
    // evidence that the gradient transform/stops rendered as a RAMP.
    expect(
      stats.distinctColours,
      "too few distinct colours → gradient flattened or families not rendered",
    ).toBeGreaterThan(16);

    // Secondary ramp evidence: a smooth 800px-wide gradient still shows
    // measurable (if gentle) local luminance variance — strictly above the
    // ~0 of a flat fill.
    expect(stats.maxLocalStd, "no local variance → gradient is a flat fill").toBeGreaterThan(0.5);
  });

  test("full-reference SSIM vs Figma ground-truth is measured (round-trip scaffold)", async ({
    page,
  }) => {
    await gotoHarness(page);
    const shot = await screenshotDataUri(page);
    const { score, windows } = await ssimInPage(page, shot, refDataUri(), W, H);
    expect(windows).toBeGreaterThan(0);
    // The measurement is valid (finite, in range). The score is REPORTED, not
    // gated at 1.0 — the deterministic fixture uses swatch assets, not the real
    // Figma bitmaps (see file header). The GOLD 1.0 proof is the live render.
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(-1);
    expect(score).toBeLessThanOrEqual(1);
    console.log(
      `[zero-loss] full-reference SSIM(817:3 render vs Figma ref) = ${score.toFixed(4)} ` +
        `over ${windows} windows (scaffold metric; swatch assets ≠ real bitmaps)`,
    );
  });
});
