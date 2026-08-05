// Content-addressing for LSML bundles. The canonical form itself lives in
// @lumencast/canonical — a leaf package, so that the compiler and the protocol
// conformance harness share one implementation instead of two copies kept in
// sync by a comment (ADR 005 §3.5).

import { bundleAddress } from "@lumencast/canonical";

export { canonicalize, ZERO_HASH } from "@lumencast/canonical";

/** Compute the sha256 content hash of a bundle, then return a copy with
 *  `scene_version` set to that hash. */
export async function hashBundle<T extends { scene_version: string }>(bundle: T): Promise<T> {
  return { ...bundle, scene_version: await bundleAddress(bundle) };
}
