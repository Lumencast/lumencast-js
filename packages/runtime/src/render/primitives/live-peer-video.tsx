import { useEffect, useRef, useState } from "react";
import { useOptionalLumencastRuntime } from "../../overlay/runtime-context";

/** Shared LIVE peer-stream rendering (ADR 006 §3.3/§3.5) — the SINGLE srcObject
 *  path used by BOTH the `media` primitive's live mode (#4, keyed on `peerLabel`)
 *  AND the generic `meet.peer` source kind (the unified source abstraction).
 *  There is no special renderer per source : every live source resolves
 *  `peerLabel → MediaStream` through the host viewer and paints it the same way.
 *
 *  Resolution : prefer the reactive channel (`subscribePeerStream`, #3) so a node
 *  mounted BEFORE its peer connects re-renders on arrival ; fall back to the
 *  one-shot `resolvePeerStream` (#4 contract) ; no host resolver → stream-less
 *  box. Reading a stream is the ONLY side effect — the scene is never mutated
 *  (RC-ReadOnly).
 *
 *  Geometry (RC-Geo) : the `<video>` fills `100%`/`100%` of the box the Tree's
 *  UniversalWrapper sized from the node's `x/y/width/height`. The geometry lives
 *  on the wrapper, NEVER on the video, so it is structurally impossible to force
 *  a full-viewport size ; `object-fit` is the scene-authored value.
 *
 *  Ownership : the stream is owned by the viewer (#3). This component is a pure
 *  consumer — unmounting clears its own `srcObject` and stops NO track (a mirror
 *  must never tear a peer down for the on-air composite). */
export function LivePeerVideo({
  peerLabel,
  objectFit,
  muted = true,
}: {
  peerLabel: string;
  objectFit: string;
  /** Audio playout hint. Always muted for now (broadcast audio is Pulsar-side). */
  muted?: boolean;
}) {
  const runtime = useOptionalLumencastRuntime();
  const resolvePeerStream = runtime?.resolvePeerStream;
  const subscribePeerStream = runtime?.subscribePeerStream;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (subscribePeerStream !== undefined) {
      return subscribePeerStream(peerLabel, setStream);
    }
    if (resolvePeerStream !== undefined) {
      setStream(resolvePeerStream(peerLabel));
      return;
    }
    setStream(null);
  }, [peerLabel, resolvePeerStream, subscribePeerStream]);

  // `srcObject` is not a serialisable attribute — attach imperatively. Never
  // stop the tracks here (the viewer owns them).
  useEffect(() => {
    const el = videoRef.current;
    if (el === null) return;
    el.srcObject = stream;
    return () => {
      if (el !== null) el.srcObject = null;
    };
  }, [stream]);

  if (stream === null) {
    // Stream-less box of the wrapper geometry — transparent, inert, paints
    // nothing. NOT an error : the peer can connect mid-show.
    return (
      <div
        aria-hidden
        data-lumencast-media-live
        style={{ width: "100%", height: "100%", opacity: 0, pointerEvents: "none" }}
      />
    );
  }

  return (
    <video
      ref={videoRef}
      data-lumencast-media-live
      autoPlay
      muted={muted}
      playsInline
      style={{
        width: "100%",
        height: "100%",
        objectFit: objectFit as React.CSSProperties["objectFit"],
        pointerEvents: "none",
      }}
    />
  );
}
