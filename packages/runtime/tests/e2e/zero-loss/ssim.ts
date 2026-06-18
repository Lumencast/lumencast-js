// SSIM (Structural SIMilarity) on raw RGBA buffers — dependency-free.
//
// ADR 002 #J / RC#10. The zero-loss harness needs an image-similarity metric
// to compare the headless render of `817:3` against the Figma ground-truth
// PNG. We compute SSIM rather than a naive per-pixel diff because RC#10 asks
// for *structural* fidelity and SSIM degrades gracefully (a single rasterised
// node collapses structure and tanks the score), while exposing a 1.0 ceiling
// for a true byte-identical match.
//
// Implementation: single-scale, global-mean SSIM on luminance, computed over
// 8×8 non-overlapping windows (the classic Wang et al. 2004 window size) with
// the standard stabilisation constants for 8-bit dynamic range. No Gaussian
// weighting (uniform window) — adequate and deterministic for a CI gate; the
// score is bit-stable across runs given identical inputs.
//
// Pure function over two equal-dimension RGBA byte arrays so it runs both in
// the browser (Playwright page context, fed by canvas `getImageData`) and in
// Node. Kept in the e2e tree because it is test-only.

const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;
const WIN = 8;

/** Rec. 601 luma. We compare structure, not colour, so a single luminance
 *  channel is the standard SSIM input. */
function luma(rgba: Uint8Array | Uint8ClampedArray, i: number): number {
  return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
}

export interface SsimResult {
  /** Mean SSIM over all windows, in [-1, 1] (1.0 = identical). */
  score: number;
  /** Number of 8×8 windows averaged. */
  windows: number;
}

/**
 * Mean SSIM between two RGBA images of identical dimensions.
 * @throws if the buffers don't match `width*height*4` or each other.
 */
export function ssim(
  a: Uint8Array | Uint8ClampedArray,
  b: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): SsimResult {
  const expected = width * height * 4;
  if (a.length !== expected || b.length !== expected) {
    throw new Error(
      `ssim: buffer length mismatch (got ${a.length}/${b.length}, expected ${expected} for ${width}×${height})`,
    );
  }

  let scoreSum = 0;
  let windows = 0;

  for (let wy = 0; wy + WIN <= height; wy += WIN) {
    for (let wx = 0; wx + WIN <= width; wx += WIN) {
      let sumA = 0;
      let sumB = 0;
      let sumAA = 0;
      let sumBB = 0;
      let sumAB = 0;
      const n = WIN * WIN;

      for (let y = 0; y < WIN; y++) {
        for (let x = 0; x < WIN; x++) {
          const idx = ((wy + y) * width + (wx + x)) * 4;
          const la = luma(a, idx);
          const lb = luma(b, idx);
          sumA += la;
          sumB += lb;
          sumAA += la * la;
          sumBB += lb * lb;
          sumAB += la * lb;
        }
      }

      const meanA = sumA / n;
      const meanB = sumB / n;
      const varA = sumAA / n - meanA * meanA;
      const varB = sumBB / n - meanB * meanB;
      const covAB = sumAB / n - meanA * meanB;

      const num = (2 * meanA * meanB + C1) * (2 * covAB + C2);
      const den = (meanA * meanA + meanB * meanB + C1) * (varA + varB + C2);
      scoreSum += num / den;
      windows += 1;
    }
  }

  return { score: windows === 0 ? 1 : scoreSum / windows, windows };
}
