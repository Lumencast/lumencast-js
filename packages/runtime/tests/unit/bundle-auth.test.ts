// Render-bundle auth — the GET that fetches a scene's render bundle is
// auth-gated identically to the LSDP/1 WS subscription. The fetcher must send
// the session token as `Authorization: Bearer <token>` (Orion accepts the
// show-token in Bearer on `GET /api/v1/scenes/{id}/render-bundle`). A
// query-string token is NOT accepted on REST GETs, only the header is.
//
// Backward-compat: when no `getAuthToken` is supplied — or it resolves to an
// empty/undefined value — the fetch stays header-less (v0.5.0 behaviour).

import { describe, expect, it } from "vitest";
import { createBundleFetcher, type RenderBundle } from "../../src/render/bundle.js";

const VERSION = "sha256:" + "b".repeat(64);

const bundle: RenderBundle = {
  scene_version: VERSION,
  root: { kind: "frame" },
};

/** A fetch stub that records the second (init) argument of each call. */
function recordingFetch(): { inits: Array<RequestInit | undefined>; impl: typeof fetch } {
  const inits: Array<RequestInit | undefined> = [];
  const impl = ((_input: string | URL | Request, init?: RequestInit) => {
    inits.push(init);
    return Promise.resolve(
      new Response(JSON.stringify(bundle), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { inits, impl };
}

function authHeader(init: RequestInit | undefined): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization;
}

describe("bundle auth — Authorization: Bearer", () => {
  it("sends the resolved token as a Bearer header", async () => {
    const { inits, impl } = recordingFetch();
    const fetcher = createBundleFetcher({
      baseUrl: "https://host.test",
      getAuthToken: () => "show-token-xyz",
      fetchImpl: impl,
    });

    await fetcher.get("scene-x", VERSION);

    expect(authHeader(inits[0])).toBe("Bearer show-token-xyz");
  });

  it("awaits an async token provider before fetching", async () => {
    const { inits, impl } = recordingFetch();
    const fetcher = createBundleFetcher({
      baseUrl: "https://host.test",
      getAuthToken: () => Promise.resolve("async-token"),
      fetchImpl: impl,
    });

    await fetcher.get("scene-x", VERSION);

    expect(authHeader(inits[0])).toBe("Bearer async-token");
  });

  it("re-resolves the token per fetch (mirrors setToken swaps)", async () => {
    const { inits, impl } = recordingFetch();
    let token = "first";
    const fetcher = createBundleFetcher({
      baseUrl: "https://host.test",
      getAuthToken: () => token,
      fetchImpl: impl,
    });

    await fetcher.get("scene-a", VERSION);
    token = "second";
    // Distinct version → not served from cache → fetches again.
    await fetcher.get("scene-b", "sha256:" + "c".repeat(64)).catch(() => undefined);

    expect(authHeader(inits[0])).toBe("Bearer first");
    expect(authHeader(inits[1])).toBe("Bearer second");
  });
});

describe("bundle auth — backward-compat (v0.5.0, no header)", () => {
  it("sends no Authorization header when getAuthToken is omitted", async () => {
    const { inits, impl } = recordingFetch();
    const fetcher = createBundleFetcher({ baseUrl: "https://host.test", fetchImpl: impl });

    await fetcher.get("scene-x", VERSION);

    // No init passed at all — header-less fetch, identical to v0.5.0.
    expect(inits[0]).toBeUndefined();
  });

  it("sends no Authorization header when the token resolves empty", async () => {
    const { inits, impl } = recordingFetch();
    const fetcher = createBundleFetcher({
      baseUrl: "https://host.test",
      getAuthToken: () => "",
      fetchImpl: impl,
    });

    await fetcher.get("scene-x", VERSION);

    expect(inits[0]).toBeUndefined();
  });

  it("sends no Authorization header when the provider resolves undefined", async () => {
    const { inits, impl } = recordingFetch();
    const fetcher = createBundleFetcher({
      baseUrl: "https://host.test",
      getAuthToken: () => Promise.resolve(undefined),
      fetchImpl: impl,
    });

    await fetcher.get("scene-x", VERSION);

    expect(inits[0]).toBeUndefined();
  });
});
