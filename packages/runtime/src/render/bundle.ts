// Render bundle — the runtime's flat, pre-compiled representation of a scene.
//
// The bundle is content-addressed by `scene_version` (sha256 of the
// canonical JSON form). Lumencast fetches it once per `scene_version` and
// caches forever; the server serves it with long-TTL immutable cache headers.
//
// Note on shape: this `RenderBundle` is the flat, runtime-internal form. The
// canonical *authoring* format (LSML 1.0, see lumencast-protocol/spec/LSML-1.md)
// uses inline `bind: { value: "path" }` per primitive instead of a `bindings`
// map. A compiler step (forthcoming `@lumencast/compiler`) will translate
// LSML 1.0 → RenderBundle. For now, callers who want to feed an LSML 1.0
// bundle pre-compile or use a hand-rolled adapter.

import type { Transition } from "../animate/transitions.js";
import type { Keyframes } from "../animate/keyframes.js";

// --- bundle shape ----------------------------------------------------

export type RenderKind =
  | "stack"
  | "grid"
  | "frame"
  | "text"
  | "image"
  | "shape"
  | "media"
  | "repeat"
  | "instance";

export interface RenderNode {
  kind: RenderKind;
  /** Stable identifier for keyed reconciliation. */
  id?: string;
  /** Static props (frozen at build/compile time). */
  props?: Record<string, unknown>;
  /** Prop name → state path. The render layer subscribes the path's signal
   *  and applies the value to the named prop on each change. */
  bindings?: Record<string, string>;
  /** Default transition per bound prop. Aligns with LSML 1.0 §6 `animate`
   *  directives. The runtime applies these as CSS transitions / Framer Motion
   *  configs at render time. */
  transitions?: Record<string, Transition>;
  /** LSML 1.1 §6 `animate.from` — mount-time initial state, lowered to a
   *  flat framer-motion `initial` map (keys: `opacity`, `scale`, `rotate`,
   *  `x`, `y`, `filter`). When present, the rendering primitive passes this
   *  as framer-motion `initial={...}` so the element mounts in this state
   *  and animates to its declared target on mount (mount-play). When absent,
   *  the primitive applies no `initial` and the prior no-mount-play
   *  behaviour holds (backward compatible). */
  animate_initial?: Record<string, number | string>;
  /** LSML 1.1 §6.3 — animation targets bound to leaf paths
   *  (`bindAnimate`). Keys are the spec property names (`opacity`,
   *  `transform.translate`, `transform.scale`, `transform.rotate`,
   *  `filter.blur`, `filter.brightness`, plus the kind's colour-typed
   *  property per §6.5 : `style.color` / `fill` / `background`) ; values
   *  are LeafPaths. The runtime subscribes each path's leaf-grain signal
   *  and retargets a Framer motion value on change — continuous
   *  interpolation toward the live value, no remount. Deltas are
   *  coalesced per frame (one retarget max per rAF per binding,
   *  ADR 001 RC#13). */
  animateBindings?: Record<string, string>;
  /** LSML 1.1 §6.6 — multi-step keyframe sequence played on mount or
   *  whenever `keyframes.key` (LeafPath) changes. Coexists with
   *  `transitions` ; the runtime applies whichever was last triggered
   *  (no blending — see §6.6 last paragraph). */
  keyframes?: Keyframes;
  /** LSML 1.1 §6.7 — only meaningful on `repeat`. Each iteration's
   *  animations start `index * stagger_ms` after iteration 0. */
  stagger_ms?: number;
  /** Children — already-inlined primitives only. */
  children?: RenderNode[];
}

export type OperatorInputType =
  | "boolean"
  | "number"
  | "text"
  | "select"
  | "enum"
  | "path-ref"
  | "colour"
  | "duration";

export interface OperatorInput {
  path: string;
  label: string;
  type: OperatorInputType;
  default?: unknown;
  group?: string;
  writable_by?: string[];
  [extra: string]: unknown;
}

export interface ExternalAdapter {
  key: string;
  label: string;
  kind: string;
  target_paths: string[];
  [extra: string]: unknown;
}

export interface Asset {
  id: string;
  url: string;
  kind: string;
  [extra: string]: unknown;
}

export interface RenderBundle {
  scene_version: string;
  root: RenderNode;
  operator_inputs?: OperatorInput[];
  external_adapters?: ExternalAdapter[];
  assets?: Asset[];
  /** LSML 1.1 §17.3 — capability profiles required for correct rendering.
   * Each entry is an `x-<vendor>.<name>/<version>` string. The runtime
   * checks every behavioural entry against its supported list ; an
   * unrecognised behavioural profile raises BUNDLE_INCOMPATIBLE per
   * §17.3.1. Authoring profiles (`x-<vendor>.authoring/<major>`, §17.5.1)
   * are advisory : ignored at render time, never a rejection cause. */
  profiles?: string[];
}

/**
 * Profiles the JS runtime advertises support for. Bundle authors who
 * declare `profiles: [...]` get a hard `BUNDLE_INCOMPATIBLE` rejection
 * when any entry is not in this set (LSML 1.1 §17.3.1).
 *
 * 1.1 ships with no standard profiles ; future minors / vendor specs
 * register here. The `x-lumencast.color-srgb-1.0` entry is the
 * default-color-space marker ; bundles that opt into a perceptual
 * space (OKLCH) would request a different profile and currently
 * reject.
 */
export const SUPPORTED_PROFILES: ReadonlySet<string> = new Set<string>([
  "x-lumencast.color-srgb-1.0",
]);

// LSML 1.1 §17.5.1 + ADR 001 RC#14 — authoring-profile detection.
//
// An authoring profile is advisory : a runtime that does not support it
// MUST NOT reject the bundle and renders the underlying primitives as if
// the profile were absent. Detection matches the COMPLETE identifier form
// `x-<vendor>.authoring/<major>` :
//
//   - `x-` prefix, then one or more lowercase name segments separated by
//     dots, where `.authoring` is the EXACT TERMINAL segment before `/` ;
//   - `<major>` is a bare integer (no `.minor`) ;
//   - never a substring test : a behavioural profile whose name merely
//     *contains* `.authoring` in a non-terminal position is NOT exempted
//     and keeps §17.3.1 hard-rejection semantics.
//
// Anti-ReDoS note : both regexes below are anchored and unambiguous —
// the character classes exclude the `.` and `/` separators, so there is
// exactly one possible parse per input (linear time, no backtracking).
const AUTHORING_NAME_RE = /^x-[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;
const AUTHORING_MAJOR_RE = /^(?:0|[1-9][0-9]*)$/;
const AUTHORING_SUFFIX = ".authoring";

/** True when `id` has the complete authoring-profile form
 * `x-<vendor>.authoring/<major>` (LSML 1.1 §17.5.1, ADR 001 RC#14).
 * Such profiles are advisory : ignored at render time, never rejected. */
export function isAuthoringProfile(id: string): boolean {
  const slash = id.indexOf("/");
  if (slash < 0) return false;
  const name = id.slice(0, slash);
  const major = id.slice(slash + 1);
  if (!AUTHORING_MAJOR_RE.test(major)) return false;
  if (!name.endsWith(AUTHORING_SUFFIX)) return false;
  // `name` minus the terminal `.authoring` segment must still be a valid
  // `x-<vendor>[.<segment>...]` prefix — this is what makes `.authoring`
  // a real terminal segment rather than a substring of another one
  // (e.g. `x-evilauthoring/1` or `x-evil.authoring.fx/1` do not match).
  return AUTHORING_NAME_RE.test(name.slice(0, -AUTHORING_SUFFIX.length));
}

export class BundleIncompatibleError extends Error {
  public readonly code = "BUNDLE_INCOMPATIBLE" as const;
  public readonly unsupportedProfiles: string[];
  constructor(unsupportedProfiles: string[]) {
    super(
      `BUNDLE_INCOMPATIBLE: profile(s) not supported by this runtime: ${unsupportedProfiles.join(
        ", ",
      )}`,
    );
    this.name = "BundleIncompatibleError";
    this.unsupportedProfiles = unsupportedProfiles;
  }
}

/** Validate a bundle's `profiles[]` against the runtime's supported
 * set. Throws `BundleIncompatibleError` listing every offending entry
 * when at least one behavioural profile is not supported.
 *
 * Authoring profiles (`x-<vendor>.authoring/<major>`, LSML 1.1 §17.5.1)
 * are advisory and skipped : their absence from the supported set is
 * never a rejection cause. Every other (behavioural) unsupported profile
 * keeps the hard §17.3.1 `BUNDLE_INCOMPATIBLE` rejection.
 *
 * Malformed-shape guard : `bundle` may come from an unchecked
 * `json as RenderBundle` cast on untrusted server JSON
 * (`FetcherImpl.get`). A non-array `profiles` or a non-string entry is
 * therefore reachable at runtime and is rejected as
 * `BundleIncompatibleError` (typed, code BUNDLE_INCOMPATIBLE) — never a
 * raw TypeError. The diagnostic never echoes the malformed value, only a
 * shape placeholder. */
export function validateBundleProfiles(
  bundle: { profiles?: string[] },
  supported: ReadonlySet<string> = SUPPORTED_PROFILES,
): void {
  const profiles: unknown = bundle.profiles;
  if (!profiles) return;
  if (!Array.isArray(profiles)) {
    throw new BundleIncompatibleError(["<malformed: profiles is not an array>"]);
  }
  if (profiles.length === 0) return;
  const missing = profiles
    .filter((p) => typeof p !== "string" || (!isAuthoringProfile(p) && !supported.has(p)))
    .map((p) => (typeof p === "string" ? p : "<malformed: non-string profile entry>"));
  if (missing.length > 0) {
    throw new BundleIncompatibleError(missing);
  }
}

// --- fetch + cache ---------------------------------------------------

export interface BundleFetcher {
  /** Fetch the bundle for a scene version. Cached forever by hash. */
  get(sceneId: string, sceneVersion: string): Promise<RenderBundle>;
  /** Inject a bundle directly — used by tests and for the "scene already in
   *  flight" handoff path. */
  preload(bundle: RenderBundle): void;
}

/** Resolves the absolute URL of a scene's render bundle. Supplied by the
 *  host (`MountOptions.resolveBundleUrl`) when the server is not at the
 *  default host-root LSDP/1 layout — e.g. reached through a gateway prefix
 *  (`https://gw/orion/api/v1/scenes/{id}/render-bundle?v={hash}`). */
export type BundleUrlResolver = (sceneId: string, sceneVersion: string) => string;

export interface BundleFetcherOptions {
  /** Base URL of the server. The fetcher constructs
   *  `${baseUrl}/lsdp/v1/scenes/{id}/bundle?v={hash}`. Ignored when
   *  `resolveUrl` is provided. */
  baseUrl: string;
  /** Path prefix for bundle resolution. Defaults to `/lsdp/v1/scenes`.
   *  Ignored when `resolveUrl` is provided. */
  pathPrefix?: string;
  /** When set, takes full control of URL construction — the host owns the
   *  whole URL (base, path prefix and `/bundle` vs `/render-bundle` suffix).
   *  Lets a gateway-prefixed server be addressed without changing the
   *  host-root default. */
  resolveUrl?: BundleUrlResolver;
  fetchImpl?: typeof fetch;
}

class FetcherImpl implements BundleFetcher {
  private readonly cache = new Map<string, RenderBundle>();
  private readonly baseUrl: string;
  private readonly pathPrefix: string;
  private readonly resolveUrl: BundleUrlResolver | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BundleFetcherOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.pathPrefix = (opts.pathPrefix ?? "/lsdp/v1/scenes").replace(/\/$/, "");
    this.resolveUrl = opts.resolveUrl;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private buildUrl(sceneId: string, sceneVersion: string): string {
    if (this.resolveUrl) {
      return this.resolveUrl(sceneId, sceneVersion);
    }
    return `${this.baseUrl}${this.pathPrefix}/${encodeURIComponent(sceneId)}/bundle?v=${encodeURIComponent(sceneVersion)}`;
  }

  preload(bundle: RenderBundle): void {
    // LSML 1.1 §17.3.1 — reject early if any declared profile is
    // unsupported by this runtime. Authors get an actionable error
    // instead of a silent rendering glitch.
    validateBundleProfiles(bundle);
    this.cache.set(bundle.scene_version, bundle);
  }

  async get(sceneId: string, sceneVersion: string): Promise<RenderBundle> {
    const cached = this.cache.get(sceneVersion);
    if (cached) return cached;
    const url = this.buildUrl(sceneId, sceneVersion);
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`bundle fetch failed: ${response.status} ${response.statusText}`);
    }
    const json = (await response.json()) as RenderBundle;
    if (json.scene_version !== sceneVersion) {
      throw new Error(
        `bundle scene_version mismatch: expected ${sceneVersion}, got ${json.scene_version}`,
      );
    }
    validateBundleProfiles(json);
    this.cache.set(sceneVersion, json);
    return json;
  }
}

export function createBundleFetcher(opts: BundleFetcherOptions): BundleFetcher {
  return new FetcherImpl(opts);
}
