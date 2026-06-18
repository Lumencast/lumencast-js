// SSIM metric sanity — ADR 002 #J. The zero-loss harness leans on SSIM as its
// similarity gate; these tests pin its contract (identical → 1.0, divergence
// → < 1, dimension guard).

import { describe, it, expect } from "vitest";
import { ssim } from "../e2e/zero-loss/ssim";

function fill(
  w: number,
  h: number,
  v: (x: number, y: number) => [number, number, number],
): Uint8Array {
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b] = v(x, y);
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

describe("ssim", () => {
  it("scores 1.0 for identical images", () => {
    const a = fill(64, 64, (x, y) => [x * 3, y * 3, (x + y) % 255]);
    const { score, windows } = ssim(a, a.slice(), 64, 64);
    expect(windows).toBe(64); // (64/8)^2
    expect(score).toBeCloseTo(1, 6);
  });

  it("scores below 1.0 when one image is structurally different", () => {
    const a = fill(64, 64, () => [0, 0, 0]);
    const b = fill(64, 64, (x) => [(x * 4) % 255, 0, 0]);
    const { score } = ssim(a, b, 64, 64);
    expect(score).toBeLessThan(0.99);
  });

  it("a uniform-vs-noise pair collapses structure (low score)", () => {
    const flat = fill(64, 64, () => [128, 128, 128]);
    let seed = 1;
    const noise = fill(64, 64, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const v = seed % 255;
      return [v, v, v];
    });
    const { score } = ssim(flat, noise, 64, 64);
    expect(score).toBeLessThan(0.5);
  });

  it("throws on a dimension mismatch", () => {
    const a = new Uint8Array(64 * 64 * 4);
    expect(() => ssim(a, new Uint8Array(10), 64, 64)).toThrow(/length mismatch/);
  });
});
