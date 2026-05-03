// Auth model — token-agnostic. The server kit only consumes the result of
// the user-supplied `authenticate` hook. LSDP/1 §8: the protocol does not
// validate tokens, it transmits them.

import type { LeafPath } from "@lumencast/protocol";

export type Role = "viewer" | "operator" | "service" | "test";

export interface AuthDecision {
  role: Role;
  /** For role=service: restrict input writes to this path prefix. Optional. */
  paths?: LeafPath[];
  /** Diagnostic — surfaced in logs / metrics, not in the wire frames. */
  subject?: string;
}

export type Authenticate = (token: string) => Promise<AuthDecision> | AuthDecision;

/**
 * Default authenticate — accepts everything as `viewer`.
 * Useful for local development; never deploy this to production.
 */
export const defaultAuthenticate: Authenticate = () => ({ role: "viewer" });

/**
 * Mutable token → AuthDecision map for test setups (interop control plane).
 * NEVER use in production — tokens are kept in process memory and any caller
 * with reset()/setMany() can rewrite the auth store.
 */
export class StaticTokens {
  private readonly map = new Map<string, AuthDecision>();

  /** Authenticate hook bound to this instance. Pass to `startServer()`. */
  authenticate: Authenticate = (token: string) => {
    const d = this.map.get(token);
    if (!d) {
      throw new (class extends Error {
        readonly code = "AUTH_DENIED" as const;
        readonly recoverable = false;
      })(`unknown token`);
    }
    return d;
  };

  set(token: string, decision: AuthDecision): void {
    this.map.set(token, decision);
  }

  setMany(entries: Iterable<[string, AuthDecision]>): void {
    for (const [t, d] of entries) this.map.set(t, d);
  }

  delete(token: string): boolean {
    return this.map.delete(token);
  }

  reset(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }
}

/** Returns true if the role is permitted to write to the given path. */
export function canWritePath(decision: AuthDecision, path: LeafPath): boolean {
  // Test sessions have their own namespace.
  if (decision.role === "test") return path.startsWith("__test.");
  // Viewers can never write.
  if (decision.role === "viewer") return false;
  // Operators can write any __inputs.* path.
  if (decision.role === "operator") return path.startsWith("__inputs.");
  // Services can write __inputs.* paths, optionally restricted by `paths`.
  if (decision.role === "service") {
    if (!path.startsWith("__inputs.")) return false;
    if (!decision.paths || decision.paths.length === 0) return true;
    return decision.paths.some((p) => path.startsWith(p));
  }
  return false;
}
