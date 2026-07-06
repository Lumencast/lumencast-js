// Regression for the guest-camera-blank-on-air bug (follow-up to #97).
//
// #97 un-muted the guest peer <video> at first render (`muted={isMuted}`), which
// in Chromium's headless CEF (Pulsar, NO user gesture) makes autoplay REJECT the
// internal `.play()` — the element freezes, not a single frame paints. The fix :
// the <video> ALWAYS renders `muted` (JSX hard `true`) so autoplay is always
// permitted, then `el.muted` is flipped imperatively once the element exists —
// un-muting an already-playing element is NOT blocked by the autoplay policy.
//
// Covered here :
//   first-render invariant — the FIRST `muted` assignment on the element is
//         always `true`, REGARDLESS of `liveAudio`/`isMuted` (so autoplay never
//         breaks).
//   imperative flip — after mount, `el.muted` settles to the value the host
//         asked for (false under `liveAudio`, true otherwise).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import type { RenderNode } from "../../src/render/bundle.js";
import { createStore } from "../../src/state/store.js";
import { LumencastRuntimeProvider } from "../../src/overlay/runtime-context.js";
import type { ResolvePeerStream } from "../../src/render/primitives/media.js";

let container: HTMLDivElement;
let root: Root;

// Instrument the `muted` DOM property so we can observe the ORDER of assignments
// (React's initial render vs. the imperative effect). jsdom defines `muted` on
// HTMLMediaElement.prototype.
let mutedHistory: boolean[];
let restoreMuted: (() => void) | undefined;

function instrumentMuted(): void {
  const proto = HTMLMediaElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, "muted");
  let backing = false;
  Object.defineProperty(proto, "muted", {
    configurable: true,
    get() {
      return backing;
    },
    set(v: boolean) {
      backing = v;
      mutedHistory.push(v);
    },
  });
  restoreMuted = () => {
    if (original !== undefined) Object.defineProperty(proto, "muted", original);
    else delete (proto as unknown as Record<string, unknown>).muted;
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mutedHistory = [];
  instrumentMuted();
});

afterEach(async () => {
  await act(async () => root.unmount());
  restoreMuted?.();
  restoreMuted = undefined;
  container.remove();
});

function realStream(): MediaStream {
  const s = new MediaStream();
  (s as unknown as { getTracks: () => MediaStreamTrack[] }).getTracks = () => [];
  return s;
}

async function renderWithViewer(
  node: RenderNode,
  resolvePeerStream: ResolvePeerStream,
  liveAudio?: boolean,
): Promise<void> {
  const store = createStore();
  await act(async () => {
    root.render(
      <LumencastRuntimeProvider
        value={{
          mode: "broadcast",
          store,
          bundle: { root: node } as never,
          status: "live",
          sendInput: () => {},
          resolvePeerStream,
          ...(liveAudio !== undefined ? { liveAudio } : {}),
        }}
      >
        <Tree node={node} store={store} />
      </LumencastRuntimeProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const peerNode: RenderNode = {
  kind: "meet.peer",
  id: "cam",
  props: { peer_label: "host_cam", object_fit: "cover" },
};

describe("LivePeerVideo — autoplay-safe mute (regression #97 blank guest cam)", () => {
  it("ALWAYS mutes at first render then un-mutes imperatively under liveAudio", async () => {
    const resolvePeerStream = vi.fn().mockReturnValue(realStream());
    await renderWithViewer(peerNode, resolvePeerStream, true);

    const video = container.querySelector("video") as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    // Autoplay invariant : the element was muted at first render (else Chromium
    // would reject autoplay and the cam would never paint).
    expect(mutedHistory[0]).toBe(true);
    // The host opted into on-air audio → the imperative effect un-muted it.
    expect(mutedHistory).toContain(false);
    expect(video!.muted).toBe(false);
  });

  it("ALWAYS mutes at first render and STAYS muted with no liveAudio", async () => {
    const resolvePeerStream = vi.fn().mockReturnValue(realStream());
    await renderWithViewer(peerNode, resolvePeerStream);

    const video = container.querySelector("video") as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    expect(mutedHistory[0]).toBe(true);
    // Never un-muted — no `false` was ever assigned.
    expect(mutedHistory).not.toContain(false);
    expect(video!.muted).toBe(true);
  });
});
