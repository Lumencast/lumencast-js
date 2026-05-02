// http_poll adapter — fetches a URL on an interval and writes the result
// as leaf-grain patches into a Scene.

import type { LeafPath, LeafValue, Patch } from "@lumencast/protocol";
import type { Scene } from "../scene.js";

export interface HttpPollOptions {
  url: string;
  intervalMs: number;
  /** Path prefix the adapter writes under — same semantic as `external_adapters[].writes_to` in LSML. */
  writesTo: LeafPath;
  /** Extract a flat record of leaf paths from the response. */
  extract: (response: unknown) => Record<LeafPath, LeafValue>;
  /** Optional headers (e.g. Authorization). */
  headers?: Record<string, string>;
  /** Optional error reporter — defaults to silent. */
  onError?: (err: unknown) => void;
}

export function startHttpPoll(scene: Scene, options: HttpPollOptions): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const res = await fetch(options.url, { headers: options.headers ?? {} });
      if (res.ok) {
        const body = (await res.json()) as unknown;
        const extracted = options.extract(body);
        const patches: Patch[] = Object.entries(extracted).map(([path, value]) => ({
          path: pathJoin(options.writesTo, path),
          value,
        }));
        if (patches.length > 0) scene.update(patches);
      } else {
        options.onError?.(new Error(`http_poll non-OK status: ${res.status}`));
      }
    } catch (err) {
      options.onError?.(err);
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), options.intervalMs);
    }
  }

  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

function pathJoin(prefix: LeafPath, sub: LeafPath): LeafPath {
  if (prefix.length === 0) return sub;
  if (sub.length === 0) return prefix;
  return `${prefix}.${sub}`;
}
