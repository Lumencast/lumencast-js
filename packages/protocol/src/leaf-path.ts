// LeafPath canonical form + scope substitution.
// Reference: LSDP/1 §10 (reserved namespaces) and LSML 1.0 §7 (repeat scope).

import type { LeafPath } from "./types.js";

/** A path segment is alphanumeric + underscore. Numeric indices are decimal. */
const SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$|^[0-9]+$/;

/** Reserved top-level namespaces per LSDP/1 §10. */
export const RESERVED_NAMESPACES = ["__inputs", "__system", "__test", "__schema"] as const;
export type ReservedNamespace = (typeof RESERVED_NAMESPACES)[number];

/** Parse a `LeafPath` string into its segments. Throws on malformed input. */
export function parseLeafPath(path: LeafPath): string[] {
  if (path.length === 0) throw new Error("leaf-path is empty");
  const segs = path.split(".");
  for (const s of segs) {
    if (!SEGMENT_RE.test(s)) {
      throw new Error(`leaf-path segment is not valid: ${s}`);
    }
  }
  return segs;
}

/** Format an array of segments back to a `LeafPath`. */
export function formatLeafPath(segments: string[]): LeafPath {
  return segments.join(".");
}

/** True if the path begins with a reserved namespace (`__inputs`, `__system`, ...). */
export function isReservedPath(path: LeafPath): boolean {
  const head = path.split(".", 1)[0];
  return (RESERVED_NAMESPACES as readonly string[]).includes(head ?? "");
}

/** True if the path begins with `__` but is NOT one of the four declared namespaces. */
export function isUnknownReservedPath(path: LeafPath): boolean {
  if (!path.startsWith("__")) return false;
  const head = path.split(".", 1)[0] ?? "";
  return !(RESERVED_NAMESPACES as readonly string[]).includes(head);
}

/**
 * Substitute `{scope}` placeholders inside a path template.
 * Used by `repeat` primitives to bind per-item paths.
 *
 * Example: `substituteScope("{player}.score", { player: "players.0" })`
 *   → "players.0.score"
 */
export function substituteScope(template: LeafPath, scopes: Record<string, string>): LeafPath {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const replacement = scopes[name];
    if (replacement === undefined) {
      throw new Error(`unknown scope identifier in path template: ${name}`);
    }
    return replacement;
  });
}
