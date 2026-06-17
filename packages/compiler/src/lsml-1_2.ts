// LSML 1.2 closed-enum parsers + bounded gradient-transform clamp
// (ADR 002 #C ; Bastion condition T4). Compiler half of the double-gate :
// the runtime re-validates the same values on the live path (#D/#E/#F wire
// `mix-blend-mode`/`object-fit`/`mask`/`gradientTransform` at render). This
// module mirrors the `css-color.ts` / `filter-clamp.ts` contract :
//
//   - a value outside the closed enum returns `null` → caller emits a
//     diagnostic and OMITS the field. NEVER passthrough of the raw value.
//   - a gradient transform is 6 finite floats, each clamped to a bounded
//     range. A malformed transform returns `null` → omitted, never a free
//     string interpolated into SVG.
//
// None of these helpers throws, logs, or echoes the offending value — the
// caller attaches a static reason to a diagnostic (Bastion R9).

import type { LSMLBlendMode, LSMLObjectFit, LSMLGradientTransform } from "./lsml-types.js";

/** Closed `mix-blend-mode` allowlist (ADR 002 §3.2 — Figma minus
 *  `PASS_THROUGH`). The single source of truth for the compiler. */
export const BLEND_MODES: ReadonlySet<LSMLBlendMode> = new Set([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]);

/** Closed `object-fit` allowlist (ADR 002 §3.2). */
export const OBJECT_FITS: ReadonlySet<LSMLObjectFit> = new Set([
  "cover",
  "contain",
  "fill",
  "none",
  "scale-down",
]);

/** Closed `mask.type` allowlist. */
export const MASK_TYPES: ReadonlySet<string> = new Set(["alpha", "luminance"]);

/** Closed `mask.op` allowlist. */
export const MASK_OPS: ReadonlySet<string> = new Set(["intersect", "subtract", "union"]);

/**
 * Validate a `blendMode` against the closed enum. Returns the value when it
 * is a recognised mode, else `null` (caller omits + diagnoses). Never
 * passthrough.
 */
export function parseBlendMode(value: unknown): LSMLBlendMode | null {
  return typeof value === "string" && BLEND_MODES.has(value as LSMLBlendMode)
    ? (value as LSMLBlendMode)
    : null;
}

/**
 * Validate an `objectFit` against the closed enum. Returns the value or
 * `null` (caller omits + diagnoses). Never passthrough.
 */
export function parseObjectFit(value: unknown): LSMLObjectFit | null {
  return typeof value === "string" && OBJECT_FITS.has(value as LSMLObjectFit)
    ? (value as LSMLObjectFit)
    : null;
}

/** Bound on each affine component (anti-DoS ; a gradient transform is purely
 *  cosmetic, no legitimate value approaches this). Mirrors the spirit of the
 *  filter caps : finite and bounded, never a free string. */
export const MAX_GRADIENT_TRANSFORM_ABS = 1e6;

/**
 * Validate + clamp a gradient `transform` to 6 finite, bounded floats. The
 * input must be an array of exactly 6 numbers ; each non-finite or
 * out-of-range component fails the whole transform (returns `null` → omit,
 * fall back to `angle_deg`). Components within range are clamped to
 * `[-MAX_GRADIENT_TRANSFORM_ABS, +MAX_GRADIENT_TRANSFORM_ABS]`. A `-0`
 * normalises to `0`. NEVER returns a string ; SVG `gradientTransform` is
 * built numerically by the runtime (#D), never interpolated from author text.
 */
export function clampGradientTransform(value: unknown): LSMLGradientTransform | null {
  if (!Array.isArray(value) || value.length !== 6) return null;
  const out = new Array<number>(6);
  for (let i = 0; i < 6; i++) {
    const c = value[i];
    if (typeof c !== "number" || !Number.isFinite(c)) return null;
    let clamped = c;
    if (clamped > MAX_GRADIENT_TRANSFORM_ABS) clamped = MAX_GRADIENT_TRANSFORM_ABS;
    else if (clamped < -MAX_GRADIENT_TRANSFORM_ABS) clamped = -MAX_GRADIENT_TRANSFORM_ABS;
    out[i] = Object.is(clamped, -0) ? 0 : clamped;
  }
  return out as LSMLGradientTransform;
}
