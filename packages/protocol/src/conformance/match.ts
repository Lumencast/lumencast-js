// Frame matcher with $ANY / $ANY_HASH sentinels. Mirrors
// lumencast-go/conformance/match.go.
//
// matchValue rules :
//   - "$ANY"      → matches any present value
//   - "$ANY_HASH" → matches a sha256:<hex64> string
//   - object → recurse on each key in the expected template; extra fields in
//     the actual object are tolerated (forward-compat)
//   - array → length and element-wise match
//   - scalar → strict equality (numeric tower normalized)

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

export interface MatchError {
  path: string;
  reason: string;
}

export function matchFrame(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): MatchError | null {
  for (const [k, want] of Object.entries(expected)) {
    if (!(k in actual)) {
      return { path: k, reason: `missing field` };
    }
    const err = matchValue(want, actual[k], k);
    if (err) return err;
  }
  return null;
}

export function matchValue(expected: unknown, actual: unknown, path: string): MatchError | null {
  if (typeof expected === "string") {
    if (expected === "$ANY") return null;
    if (expected === "$ANY_HASH") {
      if (typeof actual !== "string" || !SHA256_RE.test(actual)) {
        return { path, reason: `not a sha256 hash: ${JSON.stringify(actual)}` };
      }
      return null;
    }
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return { path, reason: `want array, got ${typeOf(actual)}` };
    }
    if (expected.length !== actual.length) {
      return { path, reason: `length ${expected.length} != ${actual.length}` };
    }
    for (let i = 0; i < expected.length; i++) {
      const err = matchValue(expected[i], actual[i], `${path}[${i}]`);
      if (err) return err;
    }
    return null;
  }
  if (typeof expected === "object" && expected !== null) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
      return { path, reason: `want object, got ${typeOf(actual)}` };
    }
    return matchFrame(expected as Record<string, unknown>, actual as Record<string, unknown>)
      ? prefix(
          path,
          matchFrame(expected as Record<string, unknown>, actual as Record<string, unknown>)!,
        )
      : null;
  }
  if (!equalScalar(expected, actual)) {
    return {
      path,
      reason: `want ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    };
  }
  return null;
}

function prefix(p: string, err: MatchError): MatchError {
  return { path: `${p}.${err.path}`, reason: err.reason };
}

function equalScalar(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
  }
  return false;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
