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
}

// --- fetch + cache ---------------------------------------------------

export interface BundleFetcher {
  /** Fetch the bundle for a scene version. Cached forever by hash. */
  get(sceneId: string, sceneVersion: string): Promise<RenderBundle>;
  /** Inject a bundle directly — used by tests and for the "scene already in
   *  flight" handoff path. */
  preload(bundle: RenderBundle): void;
}

export interface BundleFetcherOptions {
  /** Base URL of the server. The fetcher constructs
   *  `${baseUrl}/lsdp/v1/scenes/{id}/bundle?v={hash}`. */
  baseUrl: string;
  /** Path prefix for bundle resolution. Defaults to `/lsdp/v1/scenes`. */
  pathPrefix?: string;
  fetchImpl?: typeof fetch;
}

class FetcherImpl implements BundleFetcher {
  private readonly cache = new Map<string, RenderBundle>();
  private readonly baseUrl: string;
  private readonly pathPrefix: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BundleFetcherOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.pathPrefix = (opts.pathPrefix ?? "/lsdp/v1/scenes").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  preload(bundle: RenderBundle): void {
    this.cache.set(bundle.scene_version, bundle);
  }

  async get(sceneId: string, sceneVersion: string): Promise<RenderBundle> {
    const cached = this.cache.get(sceneVersion);
    if (cached) return cached;
    const url = `${this.baseUrl}${this.pathPrefix}/${encodeURIComponent(sceneId)}/bundle?v=${encodeURIComponent(sceneVersion)}`;
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
    this.cache.set(sceneVersion, json);
    return json;
  }
}

export function createBundleFetcher(opts: BundleFetcherOptions): BundleFetcher {
  return new FetcherImpl(opts);
}
