// Error helpers — typed exception + code-set membership check.
// Code semantics live in lumencast-protocol/spec/ERROR-CODES.md.

import type { ErrorCode } from "./types.js";

const ERROR_CODES = new Set<ErrorCode>([
  "AUTH_DENIED",
  "WRITE_FORBIDDEN",
  "SCENE_NOT_FOUND",
  "BUNDLE_FETCH_FAILED",
  "BUNDLE_INCOMPATIBLE",
  "VERSION_GAP",
  "VERSION_MISMATCH",
  "UNKNOWN_PATH",
  "INVALID_VALUE",
  "RATE_LIMIT",
  "TEST_SESSION_EXPIRED",
  "INTERNAL",
]);

export function isProtocolErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODES.has(value as ErrorCode);
}

export interface LumencastErrorInit {
  code: ErrorCode;
  message: string;
  recoverable: boolean;
  /**
   * REQUIRED for path-scoped codes (`WRITE_FORBIDDEN`, `UNKNOWN_PATH`,
   * `INVALID_VALUE`) per LSDP/1.0.1 §3.4.1.
   */
  path?: string;
  retry_after_ms?: number;
}

/**
 * Typed runtime exception. Mirrors the shape of an LSDP `error` frame so that
 * runtime hosts can match `error.code` against the closed taxonomy.
 */
export class LumencastError extends Error {
  readonly code: ErrorCode;
  readonly recoverable: boolean;
  readonly path: string | undefined;
  readonly retry_after_ms: number | undefined;

  constructor(init: LumencastErrorInit) {
    super(init.message);
    this.name = "LumencastError";
    this.code = init.code;
    this.recoverable = init.recoverable;
    this.path = init.path;
    this.retry_after_ms = init.retry_after_ms;
  }
}
