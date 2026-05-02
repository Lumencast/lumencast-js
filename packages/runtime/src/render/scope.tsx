import { createContext, useContext, type ReactNode } from "react";

/** Path-scope context. Children inside a `repeat` get a `prefix` that
 *  is prepended to their declared bindings, so a single template can
 *  bind to per-item paths like `items.{i}.score`. */
const PathScopeContext = createContext<string>("");

export function PathScopeProvider({ prefix, children }: { prefix: string; children: ReactNode }) {
  const parent = useContext(PathScopeContext);
  const next = parent ? `${parent}.${prefix}` : prefix;
  return <PathScopeContext.Provider value={next}>{children}</PathScopeContext.Provider>;
}

/** Returns the current path prefix, or "" if there is no scope. */
export function usePathScope(): string {
  return useContext(PathScopeContext);
}

/** Resolve a binding path under the current scope. */
export function scopedPath(prefix: string, path: string): string {
  if (!prefix) return path;
  // Path may itself start with a literal prefix (e.g. `__system.*`),
  // which should NOT be scoped — only paths that are clearly relative
  // get prefixed.
  if (path.startsWith("__")) return path;
  return `${prefix}.${path}`;
}
