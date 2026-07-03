// Per-device stream cache for `x-zab.capture` — the vcam-blink fix.
//
// Regression: a scene switch remounts the whole tree (AnimatePresence keyed on
// the scene id), so each `Capture` unmounts (stopping its tracks, RC11) and a
// fresh one re-acquires the SAME shared device. A synthetic vcam renegotiates
// slowly → a blink on every switch. The cache shares one stream per resolved
// device, ref-counted, so a switch that overlaps mount/unmount never drops the
// device to 0 refs.
//
// Covered here:
//   - two successive mounts of the SAME device → one getUserMedia, shared stream,
//     tracks never stopped while a consumer remains (the switch case).
//   - last consumer released → tracks stopped exactly once (RC11 still holds).
//   - two DIFFERENT devices → two independent acquisitions.
//   - acquisition failure → PLACEHOLDER claim, nothing to release, self-evicts
//     so a later mount retries.
//   - declared-but-unresolved ref → PLACEHOLDER, no getUserMedia, no ref.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimCaptureStream,
  releaseCaptureStream,
  __resetCaptureStreamCache,
} from "../../src/render/primitives/capture-stream-cache.js";
import type { ResolveCaptureDevice } from "../../src/render/primitives/capture.js";

/** A real `MediaStream` whose single track exposes a spy-able `stop`. */
function fakeStream(): { stream: MediaStream; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn();
  const track = { stop, kind: "video" } as unknown as MediaStreamTrack;
  const stream = new MediaStream();
  (stream as unknown as { getTracks: () => MediaStreamTrack[] }).getTracks = () => [track];
  return { stream, stop };
}

/** Install a mocked `navigator.mediaDevices` for the duration of `fn`. */
async function withMediaDevices(
  mediaDevices: Partial<MediaDevices>,
  fn: () => Promise<void>,
): Promise<void> {
  const original = (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  Object.defineProperty(navigator, "mediaDevices", { value: mediaDevices, configurable: true });
  try {
    await fn();
  } finally {
    Object.defineProperty(navigator, "mediaDevices", { value: original, configurable: true });
  }
}

const resolveTo = (deviceId: string): ResolveCaptureDevice => vi.fn().mockReturnValue({ deviceId });

beforeEach(() => __resetCaptureStreamCache());
afterEach(() => __resetCaptureStreamCache());

describe("capture-stream-cache — shared per device (vcam-blink fix)", () => {
  it("two mounts of the SAME device acquire once and share the stream", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const resolve = resolveTo("vcam");
    await withMediaDevices({ getUserMedia } as never, async () => {
      const a = await claimCaptureStream("media.webcam", "shared-vcam", resolve);
      const b = await claimCaptureStream("media.webcam", "shared-vcam", resolve);
      expect(a.kind).toBe("stream");
      expect(b.kind).toBe("stream");
      // ONE physical acquisition despite two consumers.
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      if (a.kind === "stream" && b.kind === "stream") {
        expect(a.key).toBe(b.key);
        expect(await a.promise).toBe(await b.promise);
      }
    });
  });

  it("does not stop tracks while a consumer remains, stops on the last release (RC11)", async () => {
    const { stream, stop } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const resolve = resolveTo("vcam");
    await withMediaDevices({ getUserMedia } as never, async () => {
      const a = await claimCaptureStream("media.webcam", "shared-vcam", resolve);
      const b = await claimCaptureStream("media.webcam", "shared-vcam", resolve);
      if (a.kind !== "stream" || b.kind !== "stream") throw new Error("expected streams");
      await a.promise; // let the entry.stream settle before releasing
      // Simulate the switch: old scene's node releases while the new one holds.
      releaseCaptureStream(a.key);
      expect(stop).not.toHaveBeenCalled();
      // Last consumer gone → device released.
      releaseCaptureStream(b.key);
      expect(stop).toHaveBeenCalledTimes(1);
    });
  });

  it("two DIFFERENT devices acquire independently", async () => {
    const s1 = fakeStream();
    const s2 = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValueOnce(s1.stream).mockResolvedValueOnce(s2.stream);
    await withMediaDevices({ getUserMedia } as never, async () => {
      const a = await claimCaptureStream("media.webcam", "cam-a", resolveTo("phys-a"));
      const b = await claimCaptureStream("media.webcam", "cam-b", resolveTo("phys-b"));
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      if (a.kind === "stream" && b.kind === "stream") {
        expect(a.key).not.toBe(b.key);
        expect(await a.promise).not.toBe(await b.promise);
      }
    });
  });

  it("a rejected acquisition self-evicts so a later mount retries", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce(stream);
    const resolve = resolveTo("vcam");
    await withMediaDevices({ getUserMedia } as never, async () => {
      const first = await claimCaptureStream("media.webcam", "shared-vcam", resolve);
      if (first.kind !== "stream") throw new Error("expected a stream claim");
      await expect(first.promise).rejects.toThrow("permission denied");
      // Entry evicted on rejection → the next mount acquires afresh, not a shared
      // rejected promise.
      const second = await claimCaptureStream("media.webcam", "shared-vcam", resolve);
      expect(second.kind).toBe("stream");
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      if (second.kind === "stream") expect(await second.promise).toBe(stream);
    });
  });

  it("a declared but unresolved ref yields PLACEHOLDER, no getUserMedia, no ref to release", async () => {
    const getUserMedia = vi.fn();
    const resolve = vi.fn().mockReturnValue(null);
    await withMediaDevices({ getUserMedia } as never, async () => {
      const claim = await claimCaptureStream("media.webcam", "unresolvable", resolve);
      expect(claim.kind).toBe("placeholder");
      expect(getUserMedia).not.toHaveBeenCalled();
    });
  });

  it("keys distinct kinds separately even for the same physical id", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    await withMediaDevices({ getUserMedia } as never, async () => {
      const cam = await claimCaptureStream("media.webcam", "dev", resolveTo("same"));
      const mic = await claimCaptureStream("media.mic", "dev", resolveTo("same"));
      if (cam.kind === "stream" && mic.kind === "stream") {
        expect(cam.key).not.toBe(mic.key);
      }
      expect(getUserMedia).toHaveBeenCalledTimes(2);
    });
  });
});
