// Anti-silent-drop diagnostics channel (ADR 001 §3.4 D4, issue #34).
//
// Every render-side diagnostic — rejected colour/filter/path/typography
// value, unknown prop, unrendered spec'd field — flows through
// `emitDiagnostic`. The diagnostic is an EVENT, not a console.log :
// hosts subscribe via `MountOptions.onDiagnostic` (wired by `mount()`)
// and receive a structured `{ nodeId, field, reason }`. When no handler
// is registered, the runtime falls back to a DEV-only `console.warn`
// so authors still see drops during development — and `broadcast`
// builds stay silent on the console, per the CLAUDE.md "no logs in
// broadcast" rule.
//
// ── Hygiene contract (Bastion R9, ADR 001 §5.1) ─────────────────────
// A diagnostic NEVER carries the value of a leaf or a prop — only the
// node id, the field name and a STATIC reason string. Leaf values can
// hold sensitive on-air content ; they must not transit any diagnostic
// channel. Callers pass field names and literal reasons exclusively.
// The R9 sentinel test (r9-sentinel.test.tsx) enforces this end to end,
// and statically checks that `console.warn` only exists in this module.
// ─────────────────────────────────────────────────────────────────────

/** Placeholder id for nodes that don't declare an `id`. */
export const ANON_NODE_ID = "<anon>";

export interface RenderDiagnostic {
  /** `RenderNode.id` of the node the field belongs to (RC#7), or
   *  `ANON_NODE_ID` when the node has none. */
  nodeId: string;
  /** Name of the field/prop concerned (e.g. `text.colour`,
   *  `shape.paths.data`, `bindAnimate.opacity`). Never its value (R9). */
  field: string;
  /** Static reason — why the field was rejected or not rendered. */
  reason: string;
}

export type DiagnosticHandler = (diagnostic: RenderDiagnostic) => void;

const handlers = new Set<DiagnosticHandler>();

/**
 * Register a diagnostics handler (one per `mount()`, plus tests).
 * Returns the unregister function. Multiple concurrent mounts each
 * receive every diagnostic — node ids are bundle-scoped, so a host
 * running several mounts should disambiguate on its side.
 */
export function addDiagnosticsHandler(handler: DiagnosticHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/**
 * Emit one anti-drop diagnostic. `field` and `reason` MUST be static
 * strings / field names — never interpolate a prop or leaf value (R9).
 */
export function emitDiagnostic(nodeId: string | undefined, field: string, reason: string): void {
  const diagnostic: RenderDiagnostic = { nodeId: nodeId ?? ANON_NODE_ID, field, reason };
  if (handlers.size > 0) {
    for (const handler of handlers) {
      try {
        handler(diagnostic);
      } catch {
        // A host handler that throws must never break the render path.
      }
    }
    return;
  }
  // DEV-only console fallback — broadcast builds log nothing.
  if (import.meta.env.DEV) {
    console.warn(
      `[lumencast] node "${diagnostic.nodeId}": field "${field}" ${reason} (value withheld per R9)`,
    );
  }
}
