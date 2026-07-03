// In-flight fetch coalescing — two concurrent `get()` calls for the same
// content-addressed `scene_version` must share a single HTTP fetch, and a
// failed fetch must leave no cached rejection behind (a later call retries).
// See issue #89: the roster preload (#87/#88) makes the warm-vs-snapshot race
// likely; this collapses concurrent misses to one fetch.

import { describe, expect, it } from "vitest";
import { createBundleFetcher, type RenderBundle } from "../../src/render/bundle.js";

const VERSION_A = "sha256:" + "a".repeat(64);
const VERSION_B = "sha256:" + "b".repeat(64);

function bundle(version: string): RenderBundle {
  return { scene_version: version, root: { kind: "frame" } };
}

/** Let the fetcher's internal `await buildInit()` microtask run so the stub's
 *  fetch impl is actually invoked (and its gate registered) before we assert
 *  on call counts or release it. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** A fetch stub whose resolution is held until `releaseAll()` is called, so we
 *  can observe two callers overlapping a single in-flight request. */
function deferredFetch() {
  let calls = 0;
  const gates: Array<() => void> = [];
  const impl = ((input: string | URL | Request) => {
    calls += 1;
    const url = String(input);
    // The `sha256:` prefix is percent-encoded in the URL; match on the hex run.
    const version = url.includes("b".repeat(64)) ? VERSION_B : VERSION_A;
    return new Promise<Response>((resolve) => {
      gates.push(() =>
        resolve(
          new Response(JSON.stringify(bundle(version)), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
    });
  }) as typeof fetch;
  return {
    impl,
    get calls() {
      return calls;
    },
    releaseAll() {
      for (const gate of gates.splice(0)) gate();
    },
  };
}

describe("bundle coalescing — in-flight fetch dedup", () => {
  it("collapses two concurrent gets for the same version to one fetch", async () => {
    const fetch = deferredFetch();
    const fetcher = createBundleFetcher({ baseUrl: "https://host.test", fetchImpl: fetch.impl });

    const p1 = fetcher.get("scene-a", VERSION_A);
    const p2 = fetcher.get("scene-a", VERSION_A);
    await flush();
    expect(fetch.calls).toBe(1);

    fetch.releaseAll();
    const [b1, b2] = await Promise.all([p1, p2]);

    expect(fetch.calls).toBe(1);
    expect(b1).toBe(b2);
    expect(b1.scene_version).toBe(VERSION_A);
  });

  it("issues independent fetches for different versions", async () => {
    const fetch = deferredFetch();
    const fetcher = createBundleFetcher({ baseUrl: "https://host.test", fetchImpl: fetch.impl });

    const pa = fetcher.get("scene-a", VERSION_A);
    const pb = fetcher.get("scene-b", VERSION_B);
    await flush();
    expect(fetch.calls).toBe(2);

    fetch.releaseAll();
    const [ba, bb] = await Promise.all([pa, pb]);

    expect(ba.scene_version).toBe(VERSION_A);
    expect(bb.scene_version).toBe(VERSION_B);
  });

  it("clears the in-flight entry on failure so a later call retries", async () => {
    let attempt = 0;
    const impl = ((_input: string | URL | Request) => {
      attempt += 1;
      if (attempt === 1) {
        return Promise.resolve(new Response("nope", { status: 503, statusText: "Unavailable" }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(bundle(VERSION_A)), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;
    const fetcher = createBundleFetcher({ baseUrl: "https://host.test", fetchImpl: impl });

    await expect(fetcher.get("scene-a", VERSION_A)).rejects.toThrow(/bundle fetch failed: 503/);

    // A rejected fetch must not be cached — the next call retries cleanly.
    const b = await fetcher.get("scene-a", VERSION_A);
    expect(b.scene_version).toBe(VERSION_A);
    expect(attempt).toBe(2);
  });

  it("serves from the resolved cache after the in-flight entry drains", async () => {
    const fetch = deferredFetch();
    const fetcher = createBundleFetcher({ baseUrl: "https://host.test", fetchImpl: fetch.impl });

    const p1 = fetcher.get("scene-a", VERSION_A);
    await flush();
    fetch.releaseAll();
    await p1;

    // Second call, no longer concurrent: served from the resolved cache, no fetch.
    await fetcher.get("scene-a", VERSION_A);
    expect(fetch.calls).toBe(1);
  });
});
