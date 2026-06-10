// Strict CSS colour parser — the ONLY gate through which untrusted
// colour values (bundle props AND live LSDP deltas, see `resolveProps`
// in tree.tsx) may reach an inline CSS style.
//
// ADR 001 §6 RC#11 (CSS strict) + RC#12 (anti-ReDoS), threat model
// Bastion 2026-06-10, issue #35. Sites #30/#31/#33 must reuse this
// module — never re-implement colour validation locally.
//
// Accepted grammar (LSML 1.1 §6.5 colour forms, nothing more) :
//   - hex      : #RGB | #RGBA | #RRGGBB | #RRGGBBAA
//   - rgb()    : rgb(R, G, B) | rgba(R, G, B, A) — 0-255 or percentages
//   - hsl()    : hsl(H, S%, L%) | hsla(H, S%, L%, A)
//   - named    : canonical CSS named colours + `transparent` + `currentcolor`
// Anything else — including `url(`, `;`, `}`, `expression(`, var(),
// calc(), whitespace tricks — is REJECTED (null). Never passthrough.
//
// ── Linear-time justification (RC#12, written per Bastion) ──────────
// 1. Inputs longer than MAX_LEN (64) are rejected before any regex
//    runs, so every step below operates on a bounded string.
// 2. The charset pre-scan is a single O(n) pass over one character
//    class — it rejects `;`, `}`, `:`, `/`, quotes, backslashes and
//    control characters outright, so no later step ever sees them.
// 3. Every regex is anchored (`^…$`) and built exclusively from
//    literals, character classes and BOUNDED quantifiers ({m,n}, ?).
//    There are no nested unbounded quantifiers ((a+)+ style), no
//    overlapping alternations under a quantifier — i.e. no input can
//    trigger super-linear backtracking. Combined with the 64-char cap,
//    total work is O(64) per value regardless of payload shape.
// ─────────────────────────────────────────────────────────────────────

const MAX_LEN = 64;

// Single-pass charset allowlist. Only characters that can appear in
// the accepted grammar. Notably ABSENT : `;` `}` `{` `:` `/` `"` `'`
// `\` `<` `>` `-` and all control chars — the injection metacharacters.
const CHARSET_RE = /^[#a-zA-Z0-9(),.% ]{1,64}$/;

// hex — 3/4/6/8 hex digits. Alternation of fixed-width character-class
// runs : strictly linear.
const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// Number tokens. All quantifiers bounded ; `(?:\.\d{1,4})?` is an
// optional bounded group — one possible match per position, no
// ambiguity, no backtracking blow-up.
const NUM = String.raw`\d{1,3}(?:\.\d{1,4})?`; // 0 … 999.9999
const ALPHA = String.raw`(?:0|1|0?\.\d{1,4}|${NUM}%)`; // 0-1 or %
const SP = String.raw`[ ]{0,4}`; // bounded optional spaces

// rgb(R, G, B[, A]) — channels all plain numbers or all percentages
// are both accepted (range-checked numerically after the match).
const RGB_RE = new RegExp(
  `^rgba?\\(${SP}(${NUM})(%?)${SP},${SP}(${NUM})(%?)${SP},${SP}(${NUM})(%?)${SP}` +
    `(?:,${SP}${ALPHA}${SP})?\\)$`,
);

// hsl(H[deg], S%, L%[, A])
const HSL_RE = new RegExp(
  `^hsla?\\(${SP}(${NUM})(?:deg)?${SP},${SP}(${NUM})%${SP},${SP}(${NUM})%${SP}` +
    `(?:,${SP}${ALPHA}${SP})?\\)$`,
);

// Canonical CSS named colours (CSS Color 4 §6.1) + the two keywords
// that behave like colours in every site we render.
const NAMED = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue " +
    "blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk " +
    "crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki " +
    "darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue " +
    "dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite " +
    "gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen " +
    "lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen " +
    "linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple " +
    "mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred " +
    "midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab " +
    "orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip " +
    "peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue " +
    "saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue " +
    "slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet " +
    "wheat white whitesmoke yellow yellowgreen transparent currentcolor"
  ).split(" "),
);

/**
 * Validate an untrusted colour value against the strict grammar above.
 *
 * Returns the validated string (trimmed ; named colours lowercased) or
 * `null` on rejection. A `null` MUST be handled as "omit the style /
 * use the primitive's safe default" — never interpolate the raw input.
 */
export function parseCssColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0 || v.length > MAX_LEN) return null;
  // Contractual explicit rejects (Bastion RC#11) — redundant with the
  // charset scan below, kept as belt-and-braces so the contract holds
  // even if the grammar is ever extended.
  const lower = v.toLowerCase();
  if (lower.includes("url(") || v.includes(";") || v.includes("}")) return null;
  // Single-pass charset allowlist (kills every CSS metacharacter).
  if (!CHARSET_RE.test(v)) return null;

  if (v.startsWith("#")) return HEX_RE.test(v) ? v : null;

  if (lower.startsWith("rgb")) {
    const m = RGB_RE.exec(lower);
    if (!m) return null;
    // Range check : percent channels ≤ 100, plain channels ≤ 255, no mixing.
    const pct = [m[2], m[4], m[6]];
    if (!(pct.every((p) => p === "%") || pct.every((p) => p === ""))) return null;
    const max = pct[0] === "%" ? 100 : 255;
    for (const ch of [m[1], m[3], m[5]]) {
      if (Number(ch) > max) return null;
    }
    return lower;
  }

  if (lower.startsWith("hsl")) {
    const m = HSL_RE.exec(lower);
    if (!m) return null;
    if (Number(m[1]) > 360 || Number(m[2]) > 100 || Number(m[3]) > 100) return null;
    return lower;
  }

  return NAMED.has(lower) ? lower : null;
}

/**
 * Diagnostic for a rejected value. Bastion R9 (ADR 001 §5.1) : the
 * rejected VALUE is never logged nor forwarded — only the field name
 * and a static reason. DEV-only, consistent with the existing
 * tree.tsx diagnostics (no logs in `broadcast` builds).
 */
export function warnRejectedColor(field: string): void {
  if (import.meta.env.DEV) {
    console.warn(
      `[lumencast] rejected unsafe colour for "${field}" : ` +
        "not a strict hex/rgb()/hsl()/named colour (value withheld per R9)",
    );
  }
}
