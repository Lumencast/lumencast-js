import type { PrimitiveProps } from "./index";
import { gateSrc, useAllowedHosts } from "../allowed-hosts";
import { LivePeerVideo } from "./live-peer-video";

/** Resolver injected by the consuming app (ADR 006 §3.3, #4). Maps a LOGICAL
 *  `peerLabel` (the `meet.peer.peer_label` carried by the scene) to the live
 *  `MediaStream` of that peer — supplied by the WebRTC viewer (issue #3). The
 *  stream is rendered in `srcObject` ; it NEVER enters the bundle or the content
 *  hash. Returns `null` when the peer is not (yet) connected → the node stays a
 *  stream-less box, no throw, no diagnostic (a peer can join mid-show). */
export type ResolvePeerStream = (peerLabel: string) => MediaStream | null;

/** Reactive variant (ADR 006 #3) : the viewer pushes a peer's stream when it
 *  connects and `null` when it leaves. The LIVE primitive prefers this over the
 *  one-shot resolver so a node that mounted BEFORE the peer connected re-renders
 *  on arrival (a peer joins mid-show). The listener is invoked immediately with
 *  the current value, then on every change ; the return value unsubscribes.
 *  Like `resolvePeerStream`, it is injected at mount — never the bundle. */
export type SubscribePeerStream = (
  peerLabel: string,
  listener: (stream: MediaStream | null) => void,
) => () => void;

/** Embedded video. Two source modes, picked by the node's props :
 *
 *   - **BUNDLE** (`src`, the original mode) : a `<video src>` of a bundled /
 *     gated URL. Audio muted by default (broadcast audio is Pulsar-side). `src`
 *     is the sole network sink and MUST pass `gateSrc` before reaching the
 *     `<video>` (Bastion, ADR 003 — an off-allowlist request is an SSRF surface
 *     in headless `zabrender`). A rejected host/scheme omits the source.
 *
 *   - **LIVE** (`peerLabel`, ADR 006 #4) : the source is a `meet.peer`'s
 *     `peer_label`. The runtime resolves the peer's `MediaStream` through a
 *     host-provided resolver (`resolvePeerStream`, injected at mount — NOT the
 *     bundle, like `resolveCaptureDevice`) and renders it imperatively via
 *     `<video>.srcObject` in real time. No URL, no `gateSrc` (a `MediaStream`
 *     is not a network sink). An absent resolver or an unconnected peer leaves a
 *     stream-less box — no throw, no diagnostic (peers join mid-show).
 *
 *  `peerLabel` takes precedence when present (a live node), else `src` (bundle).
 *
 *  Geometry is read-only (ADR 006 A1.6) : the node's `x/y/width/height` are
 *  applied by the Tree's UniversalWrapper around this primitive ; the `<video>`
 *  fills that box (`100%`/`100%`) with the scene-authored `object-fit`. The
 *  primitive NEVER forces full-screen and NEVER writes any geometry back — it
 *  only reads `resolved`. */
export function Media({ resolved, nodeId }: PrimitiveProps) {
  const allowedHosts = useAllowedHosts();
  const fit = (resolved.fit as string | undefined) ?? "cover";
  const peerLabel =
    typeof resolved.peerLabel === "string" && resolved.peerLabel.length > 0
      ? resolved.peerLabel
      : "";

  if (peerLabel !== "") {
    // LIVE mode — the SAME srcObject path as the generic `meet.peer` source.
    return <LivePeerVideo peerLabel={peerLabel} objectFit={fit} />;
  }

  // BUNDLE mode (unchanged) — gated `<video src>`.
  const src = gateSrc(resolved.src, allowedHosts, "media.src", nodeId);
  if (!src) return null;
  const loop = (resolved.loop as boolean | undefined) ?? true;
  const mute = (resolved.mute as boolean | undefined) ?? true;
  const autoplay = (resolved.autoplay as boolean | undefined) ?? true;

  return (
    <video
      src={src}
      autoPlay={autoplay}
      loop={loop}
      muted={mute}
      playsInline
      style={fillBox(fit)}
    />
  );
}

/** The bundle `<video src>` fills the box the UniversalWrapper sized from the
 *  node's `width`/`height` (RC-Geo) ; `object-fit` is the scene-authored `fit`.
 *  The geometry lives on the wrapper, never on the video. */
function fillBox(fit: string): React.CSSProperties {
  return {
    width: "100%",
    height: "100%",
    objectFit: fit as React.CSSProperties["objectFit"],
  };
}
