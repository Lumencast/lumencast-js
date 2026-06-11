// Issue #53 — render-bundle URL must be addressable behind a gateway prefix.
//
// `createBundleFetcher` builds the bundle URL. By default it derives the
// host-root LSDP/1 layout (`/lsdp/v1/scenes/{id}/bundle?v=`). A host that
// reaches the server through a gateway prefix (Orion behind ZabGate) passes
// `resolveUrl` to own the whole URL, including the `/render-bundle` suffix.
// These tests pin both paths and prove strict backward-compat of the default.

import { describe, expect, it } from "vitest";
import { createBundleFetcher, type RenderBundle } from "../../src/render/bundle.js";

const VERSION = "sha256:" + "a".repeat(64);

const bundle: RenderBundle = {
  scene_version: VERSION,
  root: { kind: "frame" },
};

/** A fetch stub that records the URL it was asked for and returns `bundle`. */
function recordingFetch(): { calls: string[]; impl: typeof fetch } {
  const calls: string[] = [];
  const impl = ((input: string | URL | Request) => {
    calls.push(typeof input === "string" ? input : input.toString());
    return Promise.resolve(
      new Response(JSON.stringify(bundle), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { calls, impl };
}

describe("bundle URL — default (backward compatible, v0.4.0)", () => {
  it("derives /lsdp/v1/scenes/{id}/bundle?v={hash} from baseUrl", async () => {
    const { calls, impl } = recordingFetch();
    const fetcher = createBundleFetcher({ baseUrl: "https://host.test", fetchImpl: impl });

    await fetcher.get("scene-x", VERSION);

    expect(calls).toEqual([
      `https://host.test/lsdp/v1/scenes/scene-x/bundle?v=${encodeURIComponent(VERSION)}`,
    ]);
  });

  it("honours a custom pathPrefix while keeping the /bundle suffix", async () => {
    const { calls, impl } = recordingFetch();
    const fetcher = createBundleFetcher({
      baseUrl: "https://host.test",
      pathPrefix: "/custom/scenes",
      fetchImpl: impl,
    });

    await fetcher.get("scene-x", VERSION);

    expect(calls[0]).toBe(
      `https://host.test/custom/scenes/scene-x/bundle?v=${encodeURIComponent(VERSION)}`,
    );
  });
});

describe("bundle URL — resolveUrl (gateway-prefixed server, issue #53)", () => {
  it("uses the host-supplied resolver verbatim — Orion behind ZabGate", async () => {
    const { calls, impl } = recordingFetch();
    const fetcher = createBundleFetcher({
      // baseUrl is still required by the type but must be ignored here.
      baseUrl: "https://ignored.test",
      resolveUrl: (id, v) =>
        `https://zabgate.cyell.dev/orion/api/v1/scenes/${id}/render-bundle?v=${v}`,
      fetchImpl: impl,
    });

    await fetcher.get("home", VERSION);

    expect(calls).toEqual([
      `https://zabgate.cyell.dev/orion/api/v1/scenes/home/render-bundle?v=${VERSION}`,
    ]);
  });

  it("resolver receives the exact sceneId and sceneVersion", async () => {
    const { impl } = recordingFetch();
    const seen: Array<[string, string]> = [];
    const fetcher = createBundleFetcher({
      baseUrl: "https://ignored.test",
      resolveUrl: (id, v) => {
        seen.push([id, v]);
        return `https://gw.test/b?id=${id}&v=${v}`;
      },
      fetchImpl: impl,
    });

    await fetcher.get("scene-42", VERSION);

    expect(seen).toEqual([["scene-42", VERSION]]);
  });
});
