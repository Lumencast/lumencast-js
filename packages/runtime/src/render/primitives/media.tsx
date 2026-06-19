import type { PrimitiveProps } from "./index";
import { gateSrc, useAllowedHosts } from "../allowed-hosts";

/** Embedded video. `src`, `loop`, `mute`, `autoplay`. Audio is muted
 *  by default — broadcast audio is Pulsar-side, not from the browser
 *  source.
 *
 *  Security (Bastion, ADR 003) : `src` is the media primitive's sole
 *  network sink (no `poster` / `<source>` / `<track>` are rendered). Like
 *  every other asset leaf (image / image-fill / mask) it MUST pass
 *  `gateSrc` BEFORE reaching the `<video>` — otherwise a `kind:"media"`
 *  node would make the headless Chromium of `zabrender` emit an
 *  off-allowlist request (an SSRF surface). A rejected host/scheme omits
 *  the source entirely (no passthrough), with an R9-clean diagnostic
 *  ({ nodeId, field, reason } — never the URL). */
export function Media({ resolved, nodeId }: PrimitiveProps) {
  const allowedHosts = useAllowedHosts();
  const src = gateSrc(resolved.src, allowedHosts, "media.src", nodeId);
  if (!src) return null;
  const loop = (resolved.loop as boolean | undefined) ?? true;
  const mute = (resolved.mute as boolean | undefined) ?? true;
  const autoplay = (resolved.autoplay as boolean | undefined) ?? true;
  const fit = (resolved.fit as string | undefined) ?? "cover";

  return (
    <video
      src={src}
      autoPlay={autoplay}
      loop={loop}
      muted={mute}
      playsInline
      style={{
        width: "100%",
        height: "100%",
        objectFit: fit as React.CSSProperties["objectFit"],
      }}
    />
  );
}
