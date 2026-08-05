// Content address of an inline LSML bundle, per LSML 1.0 §3.
//
// This was a copy of @lumencast/compiler kept in sync by a comment, to dodge a
// circular workspace dep. The two drifted anyway — including on the rule below,
// which the copy applied conditionally and the original unconditionally. Both
// now import the leaf package @lumencast/canonical (ADR 005 §3.5).

import { bundleAddress } from "@lumencast/canonical";

export { canonicalize } from "@lumencast/canonical";

/** Hash an inline LSML bundle, returning the `sha256:<hex>` identity. */
export async function hashInlineBundle(inline: unknown): Promise<string> {
  return bundleAddress(inline);
}
