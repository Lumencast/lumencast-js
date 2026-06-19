// Strict `mix-blend-mode` gate — the runtime half of the T4 double-gate
// (Bastion conditions 1.2, ADR 002 §3.2 / #D).
//
// The compiler already validates `blendMode` against its closed enum
// (`parseBlendMode`, @lumencast/compiler) before emitting the universal
// prop. This module is the INDEPENDENT runtime gate : a bundle prop OR a
// live LSDP delta value reaching the wrapper is re-validated here against
// the same closed allowlist before it may touch an inline CSS style.
// Anything outside the enum is omitted (never passthrough) — mirroring
// the `css-color.ts` discipline (self-contained second gate, no untrusted
// string ever interpolated into CSS).
//
// The allowlist is intentionally duplicated rather than imported from the
// compiler : the runtime does not depend on @lumencast/compiler, and the
// gate must hold even if a hand-rolled / tampered bundle bypasses the
// compiler entirely. It is a fixed, finite set of CSS keywords (Figma
// blend modes minus PASS_THROUGH) — the single source of truth for the
// CSS value is this closed set.

/** Closed `mix-blend-mode` allowlist (ADR 002 §3.2 — Figma minus
 *  `PASS_THROUGH`). Mirrors the compiler's `BLEND_MODES`. */
const BLEND_MODES: ReadonlySet<string> = new Set([
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
  // Figma LINEAR_DODGE (add) — exact additive blend, gentler than color-dodge.
  "plus-lighter",
]);

/**
 * Re-validate a resolved `blendMode` against the closed enum. Returns the
 * CSS `mix-blend-mode` keyword when recognised, else `undefined` (caller
 * omits — the value never reaches the style). Never passthrough.
 */
export function parseBlendMode(value: unknown): string | undefined {
  return typeof value === "string" && BLEND_MODES.has(value) ? value : undefined;
}
