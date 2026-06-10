// Runtime half of the R8 filter gate (ADR 001 §5.1 R8, issue #42).
//
// The compiler clamps `filter` values at lowering (`lowerFilter`,
// packages/compiler/src/compile.ts) — but a filter value pushed by a
// LIVE LSDP delta reaches the runtime through `resolveProps` /
// `animateBindings` without ever passing through the compiler. R8
// requires the clamp at compile AND at runtime : an unbounded filter is
// a compositing DoS in CEF. Every filter value that can reach an inline
// style at render time MUST pass through this module.
//
// NOTE on duplication : these caps intentionally mirror the compiler's
// `MAX_FILTER_BLUR_PX` / `MAX_FILTER_BRIGHTNESS` constants. Unifying
// them behind a single shared module is tracked by issue #41 (same
// model as the shared colour module) — do NOT change one side without
// the other until #41 lands.
//
// ── Linear-time justification (RC#12) ────────────────────────────────
// The string form is validated by a single ANCHORED regex made of
// literals and bounded quantifiers ({1,7} / {1,4} digit runs, one
// optional space run) — exactly one possible parse per input, no
// backtracking blow-up. Inputs longer than MAX_FILTER_STRING_LEN are
// rejected before the regex runs.
// ─────────────────────────────────────────────────────────────────────

/** Max CSS `blur()` radius accepted at runtime, in px (mirror of the
 *  compiler cap — see issue #41). */
export const MAX_FILTER_BLUR_PX = 100;
/** Max CSS `brightness()` factor accepted at runtime (mirror of the
 *  compiler cap — see issue #41 ; spec §6.1 blesses clamping to 4). */
export const MAX_FILTER_BRIGHTNESS = 4;

const MAX_FILTER_STRING_LEN = 64;

const CAPS: Record<FilterChannel, number> = {
  blur: MAX_FILTER_BLUR_PX,
  brightness: MAX_FILTER_BRIGHTNESS,
};

export type FilterChannel = "blur" | "brightness";

/**
 * Gate one live numeric filter channel (R8 runtime half).
 *
 * Returns the clamped value, or `null` when the value is rejected
 * (non-number, non-finite, negative — including `-0`, which would
 * stringify to an accepted `0`). A `null` MUST be handled as "keep the
 * last known-good value / identity" — never apply the raw input.
 */
export function clampFilterChannel(channel: FilterChannel, value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || Object.is(value, -0)) return null;
  const cap = CAPS[channel];
  return value > cap ? cap : value;
}

// The ONLY string form the compiler ever emits (`lowerFilter`) :
// `blur(<n>px) brightness(<n>)`. Anything else — extra functions,
// `url(`, negative signs, exponents — is rejected by construction
// (the grammar has no `-`, no `e`, no second parenthesis pair).
const FILTER_STRING_RE =
  /^blur\((\d{1,7}(?:\.\d{1,4})?)px\) brightness\((\d{1,7}(?:\.\d{1,4})?)\)$/;

/** Identity filter — matches the compiler's neutral emission and
 *  `INITIAL_IDENTITY.filter` in transitions.ts. */
export const FILTER_IDENTITY = "blur(0px) brightness(1)";

/**
 * Gate a CSS filter STRING reaching framer-motion at runtime
 * (`animate_initial.filter`, keyframe `steps[].filter`). Hand-crafted
 * bundles bypass the compiler clamps, so the runtime re-validates and
 * re-clamps (R8). Returns the safe, clamped canonical string or `null`
 * on rejection — never the raw input.
 */
export function sanitizeCssFilterString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_FILTER_STRING_LEN) return null;
  const m = FILTER_STRING_RE.exec(value);
  if (!m) return null;
  const blur = clampFilterChannel("blur", Number(m[1]));
  const brightness = clampFilterChannel("brightness", Number(m[2]));
  if (blur === null || brightness === null) return null;
  return `blur(${blur}px) brightness(${brightness})`;
}

/**
 * Diagnostic for a rejected filter value. Bastion R9 (ADR 001 §5.1) :
 * the rejected VALUE is never logged nor forwarded — only the field
 * name and a static reason. DEV-only (no logs in `broadcast` builds).
 */
export function warnRejectedFilter(field: string): void {
  if (import.meta.env.DEV) {
    console.warn(
      `[lumencast] rejected unsafe filter value for "${field}" : ` +
        "outside the R8 caps or not a finite number >= 0 (value withheld per R9)",
    );
  }
}
