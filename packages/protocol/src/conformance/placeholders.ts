// Placeholder substitution for scenarios.
//
// Two placeholder families :
//   - $TOKEN_OPERATOR / $TOKEN_VIEWER / $TOKEN_SERVICE / $TOKEN_TEST / $TOKEN_INVALID
//     → live token strings supplied by the harness via /test/setup
//   - $BUNDLE.<id>.hash
//     → sha256:<hex> of the inline bundle declared in scenario.bundles
//
// Unknown placeholders pass through verbatim. Some scenarios rely on this
// (auth-denied uses $TOKEN_INVALID literally because the server should reject
// any value the harness substitutes — cleaner to send the literal string).

const TOKEN_PREFIX = "$TOKEN_";
const BUNDLE_PREFIX = "$BUNDLE.";
const BUNDLE_SUFFIX = ".hash";

export function substitute(
  value: unknown,
  tokens: Record<string, string>,
  bundleHashes: Record<string, string>,
): unknown {
  if (typeof value === "string") {
    if (value.startsWith(TOKEN_PREFIX)) {
      const replacement = tokens[value];
      return replacement ?? value;
    }
    if (value.startsWith(BUNDLE_PREFIX) && value.endsWith(BUNDLE_SUFFIX)) {
      const id = value.slice(BUNDLE_PREFIX.length, value.length - BUNDLE_SUFFIX.length);
      const hash = bundleHashes[id];
      return hash ?? value;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => substitute(v, tokens, bundleHashes));
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substitute(v, tokens, bundleHashes);
    }
    return out;
  }
  return value;
}
