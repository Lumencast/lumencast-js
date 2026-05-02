import type { PrimitiveProps } from "./index";

/** Embedded video. `src`, `loop`, `mute`, `autoplay`. Audio is muted
 *  by default — broadcast audio is Pulsar-side, not from the browser
 *  source. */
export function Media({ resolved }: PrimitiveProps) {
  const src = resolved.src as string | undefined;
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
