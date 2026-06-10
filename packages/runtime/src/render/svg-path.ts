// Strict SVG path-data validator — the ONLY gate through which
// untrusted `d` strings (bundle props AND live LSDP deltas, see
// `resolveProps` in tree.tsx) may reach a rendered `<path d>` attribute.
//
// ADR 001 §6 RC#10 (allowlisted `d` grammar) + RC#12 (anti-ReDoS),
// threat model Bastion 2026-06-10, issue #30. Validation runs at EVERY
// render — props are wire-drivable, so a hostile delta arriving after
// mount goes through the exact same gate as a static prop.
//
// Accepted grammar (SVG path data, LSML 1.1 §4.6, nothing more) :
//   - command letters : M m L l H h V v C c S s Q q T t A a Z z
//   - numbers         : [+-]? digits [. digits]? ([eE] [+-]? digits)?
//   - separators      : space, tab, CR, LF, comma
// Anything else — including `url(`, `data:`, `<`, `&`, parentheses,
// quotes, semicolons, braces — is REJECTED (null). Never passthrough.
//
// ── Linear-time justification (RC#12, written per Bastion) ──────────
// 1. Inputs longer than MAX_SUBPATH_LEN (8 KiB) are rejected on a
//    single O(1) length check before any scanning — a 10⁶-command
//    payload never reaches the scanner.
// 2. The scanner is a hand-written single forward pass : every loop
//    iteration advances `i` by at least one character and there is no
//    regex anywhere, so total work is O(min(n, 8192)) per value
//    regardless of payload shape. No backtracking is possible by
//    construction.
// 3. The command cap (MAX_SUBPATH_COMMANDS) additionally bounds the
//    number of path segments the SVG engine will ever be asked to
//    tessellate, independently of string length.
// ─────────────────────────────────────────────────────────────────────

/** RC#10 — hard cap : 8 KiB per subpath `d` string. */
export const MAX_SUBPATH_LEN = 8192;
/** RC#10 — hard cap on commands per subpath. */
export const MAX_SUBPATH_COMMANDS = 4096;
/** RC#10 — hard cap on subpaths per shape. */
export const MAX_SUBPATHS = 64;

const CMD_CHARS = new Set("MmLlHhVvCcSsQqTtAaZz");

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39; // 0-9
}

function isSeparator(code: number): boolean {
  // space, tab, CR, LF, comma
  return code === 0x20 || code === 0x09 || code === 0x0d || code === 0x0a || code === 0x2c;
}

/**
 * Validate an untrusted SVG path `d` string against the strict grammar
 * above. Returns the validated (trimmed) string or `null` on rejection.
 * A `null` MUST be handled as "omit the subpath + emit a diagnostic" —
 * never interpolate the raw input into the DOM.
 */
export function validatePathData(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // O(1) length gate BEFORE any per-character work (RC#12).
  if (value.length === 0 || value.length > MAX_SUBPATH_LEN) return null;
  const d = value.trim();
  if (d.length === 0) return null;

  // Contractual explicit rejects (Bastion RC#10) — redundant with the
  // allowlist scan below, kept as belt-and-braces so the contract
  // holds even if the grammar is ever extended.
  const lower = d.toLowerCase();
  if (lower.includes("url(") || lower.includes("data:")) return null;
  if (d.includes("<") || d.includes("&")) return null;

  // Single forward pass — tokenizes commands and numbers, rejects any
  // character outside the allowlist, counts commands.
  const n = d.length;
  let i = 0;
  let commands = 0;
  let sawCommand = false;
  while (i < n) {
    const code = d.charCodeAt(i);
    if (isSeparator(code)) {
      i++;
      continue;
    }
    const ch = d[i];
    if (CMD_CHARS.has(ch)) {
      // Path data must start with a moveto (M/m).
      if (!sawCommand && ch !== "M" && ch !== "m") return null;
      sawCommand = true;
      commands++;
      if (commands > MAX_SUBPATH_COMMANDS) return null;
      i++;
      continue;
    }
    // Anything else must be a well-formed number token — and numbers
    // can only appear after the leading moveto.
    if (!sawCommand) return null;
    if (ch === "+" || ch === "-") i++;
    let digits = 0;
    while (i < n && isDigit(d.charCodeAt(i))) {
      i++;
      digits++;
    }
    if (i < n && d[i] === ".") {
      i++;
      while (i < n && isDigit(d.charCodeAt(i))) {
        i++;
        digits++;
      }
    }
    if (digits === 0) return null; // bare sign / dot / forbidden char
    if (i < n && (d[i] === "e" || d[i] === "E")) {
      i++;
      if (i < n && (d[i] === "+" || d[i] === "-")) i++;
      let expDigits = 0;
      while (i < n && isDigit(d.charCodeAt(i))) {
        i++;
        expDigits++;
      }
      if (expDigits === 0) return null;
    }
  }
  if (commands === 0) return null;
  return d;
}

export interface SubPath {
  d: string;
  fillRule: "nonzero" | "evenodd";
}

/**
 * Resolve a shape's `pathData` / `paths[]` props (LSML 1.1 §4.6) into
 * validated subpaths ready for rendering — one `<path>` element per
 * entry (ADR 001 §3.2.3). `pathData` is equivalent to
 * `paths: [{ data: pathData, windingRule: "NONZERO" }]`.
 *
 * Re-runs at every render (RC#10 — props are live via LSDP deltas).
 * Every rejected or unrendered field emits a diagnostic (ADR 001 §3.4,
 * anti-silent-drop) that NEVER contains the value (R9).
 */
export function parseShapePaths(resolved: Record<string, unknown>): SubPath[] {
  const rawPaths = resolved.paths;
  const rawPathData = resolved.pathData;

  if (Array.isArray(rawPaths)) {
    if (rawPathData !== undefined) {
      // Spec §4.6 : mutually exclusive. Tolerate with paths[] winning
      // (mirrors the fills[]/fill precedence), but never silently.
      warnPath("shape.pathData", "mutually exclusive with paths[] ; paths[] wins");
    }
    const out: SubPath[] = [];
    for (let idx = 0; idx < rawPaths.length; idx++) {
      if (out.length >= MAX_SUBPATHS) {
        warnPath("shape.paths", "subpath cap exceeded ; remaining entries dropped");
        break;
      }
      const entry = rawPaths[idx] as { data?: unknown; windingRule?: unknown } | null;
      const d = validatePathData(
        typeof entry === "object" && entry !== null ? entry.data : undefined,
      );
      if (d === null) {
        warnPath("shape.paths.data", "not a strict SVG path grammar (allowlist/caps)");
        continue;
      }
      out.push({ d, fillRule: toFillRule(entry?.windingRule) });
    }
    if (out.length === 0 && rawPaths.length > 0) {
      warnPath("shape.paths", "no renderable subpath ; shape geometry omitted");
    }
    return out;
  }

  if (rawPathData !== undefined) {
    const d = validatePathData(rawPathData);
    if (d === null) {
      warnPath("shape.pathData", "not a strict SVG path grammar (allowlist/caps)");
      return [];
    }
    return [{ d, fillRule: "nonzero" }];
  }

  // geometry:"path" with neither prop — spec'd field combination we
  // cannot render. Diagnostic, never a silent no-op (ADR 001 §3.4).
  warnPath("shape.paths", "geometry is path but neither pathData nor paths[] is present");
  return [];
}

function toFillRule(windingRule: unknown): "nonzero" | "evenodd" {
  if (windingRule === undefined || windingRule === "NONZERO") return "nonzero";
  if (windingRule === "EVENODD") return "evenodd";
  warnPath("shape.paths.windingRule", "unknown winding rule ; defaulting to nonzero");
  return "nonzero";
}

/**
 * Diagnostic for a rejected / unrendered path field. Bastion R9
 * (ADR 001 §5.1) : the rejected VALUE is never logged nor forwarded —
 * only the field name and a static reason. DEV-only, consistent with
 * css-color.ts (no logs in `broadcast` builds).
 */
function warnPath(field: string, reason: string): void {
  if (import.meta.env.DEV) {
    console.warn(`[lumencast] shape path "${field}" : ${reason} (value withheld per R9)`);
  }
}
