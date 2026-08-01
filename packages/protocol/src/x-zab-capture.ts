// `x-zab.capture` vendor primitive — the SINGLE source of truth for its
// `sourceKind` enum, its `deviceRef` grammar and its `size` requirement
// (RFC-0001 + Amendment 2 §A2.2 / §A2.4 / §A2.7).
//
// It lives in `@lumencast/protocol` — the only package every consumer
// already depends on — because the same three rules are enforced in three
// places that must never drift apart :
//   - the compiler, at lowering (`compile.ts`) ;
//   - the runtime, to decide whether a stream is painted (`capture.tsx`) ;
//   - the server kit, on an untrusted inline bundle (`test-control.ts`).
// Three copies of the enum is exactly how `media.file`, `media.game` and
// `media.system_audio` drifted unnoticed for months (§A2.1).
//
// Amendment 2 §A2.7 is normative : these sets MUST be reachable as VALUES,
// not only as TypeScript types, so a consumer can assert its own list is
// included in ours at build time.

/** RFC-0001 A2 §A2.2 — the `x-zab.sourceKind` enum (nine values).
 *
 *  `media.app` (Amendment 3) is a window capture that PERSISTS ACROSS the
 *  captured app's process restarting — a native `window_capture` matched
 *  by executable name (libobs `priority`) instead of a specific window
 *  instance/handle, which goes stale the moment the app relaunches with a
 *  new HWND. Same wire shape as `media.window` (a `deviceRef` + geometry) ;
 *  the app-vs-window distinction is resolved entirely by the consuming app
 *  (Prism's capture-resolver), never carried as a physical id in the bundle. */
export const CAPTURE_SOURCE_KINDS: ReadonlySet<string> = new Set([
  "media.webcam",
  "media.screen",
  "media.window",
  "media.app",
  "media.file",
  "media.game",
  "media.app_audio",
  "media.system_audio",
  "media.mic",
]);

/** RFC-0001 A2 §A2.4 — the visual subset, a SECOND set and not a filter on
 *  the enum. `size` is required for these : the placeholder's geometry is
 *  what lets the consuming app position the native source over the exact box
 *  the author drew, so a zero-area visual box is malformed, not degraded.
 *  Extending `CAPTURE_SOURCE_KINDS` without extending this set is the §A2.4
 *  trap — it lets a `media.file` with no `size` through, silently. */
export const CAPTURE_VISUAL_KINDS: ReadonlySet<string> = new Set([
  "media.webcam",
  "media.screen",
  "media.window",
  "media.app",
  "media.file",
  "media.game",
]);

/** RFC-0001 — `x-zab.deviceRef` is a logical, hash-safe alias, never a
 *  physical device_id. The pattern rejects a UUID, a `device:0` style id,
 *  uppercase, leading digit, or anything over 64 chars. Anchored, no
 *  backtracking (anti-ReDoS). */
export const CAPTURE_DEVICE_REF_RE = /^[a-z][a-z0-9-]{0,63}$/;

/** The one vendor-prefixed `kind` this module recognises. */
export const ZAB_CAPTURE_KIND = "x-zab.capture";

/**
 * Validate every `x-zab.capture` node reachable from `root` against RFC-0001
 * (+ Amendment 2), leaving every other node untouched. `root` is decoded JSON
 * (plain objects / arrays), typically an LSML `layout`.
 *
 * Deliberately narrower than a full LSML validation : a caller holding an
 * untrusted inline layout can enforce the vendor contract without also taking
 * a position on core primitives it may not know yet — the bundles that reach
 * it come from several LSML minors.
 *
 * Returns the first violation message, or `null` when every capture node is
 * well-formed.
 */
export function checkZabCaptureNodes(root: unknown): string | null {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== "object" || node === null || Array.isArray(node)) continue;
    const obj = node as Record<string, unknown>;
    if (obj["kind"] === ZAB_CAPTURE_KIND) {
      const err = checkZabCaptureNode(obj);
      if (err !== null) return err;
    }
    const children = obj["children"];
    if (Array.isArray(children)) stack.push(...children);
    if ("template" in obj) stack.push(obj["template"]);
  }
  return null;
}

/** Apply the RFC-0001 prop rules to a single `x-zab.capture` node. */
function checkZabCaptureNode(obj: Record<string, unknown>): string | null {
  const sourceKind = obj["x-zab.sourceKind"];
  if (typeof sourceKind !== "string" || sourceKind === "") {
    return `\`${ZAB_CAPTURE_KIND}\` must declare \`x-zab.sourceKind\` (RFC-0001)`;
  }
  if (!CAPTURE_SOURCE_KINDS.has(sourceKind)) {
    return `\`x-zab.sourceKind\` "${sourceKind}" is not a recognised capture source kind (RFC-0001 A2 §A2.2)`;
  }

  const deviceRef = obj["x-zab.deviceRef"];
  if (typeof deviceRef !== "string" || !CAPTURE_DEVICE_REF_RE.test(deviceRef)) {
    return `\`x-zab.deviceRef\` must be a logical alias matching ^[a-z][a-z0-9-]{0,63}$ — never a physical device_id (RFC-0001)`;
  }

  // §A2.4 — the visual set is a SECOND set, not a subset check on the enum.
  if (CAPTURE_VISUAL_KINDS.has(sourceKind) && obj["size"] === undefined) {
    return `\`${ZAB_CAPTURE_KIND}\` of visual kind "${sourceKind}" must declare \`size\` (RFC-0001 A2 §A2.2)`;
  }
  return null;
}
