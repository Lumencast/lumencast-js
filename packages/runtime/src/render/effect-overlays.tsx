// NOISE / TEXTURE / GLASS — Figma 2024 effects with no direct CSS
// primitive (ADR 014 Tier B, Prism issue #355). Rendered generically here
// (one component, mounted once per node from `UniversalWrapper`) rather
// than duplicated across every primitive, since none of the
// approximations below need to know the host primitive's own paint —
// they're pure overlays stacked on top of whatever the primitive already
// painted. Same visual approximation as the Prism editor's
// `effect-overlays.tsx` (not pixel-parity with Figma) :
//
//   - NOISE / TEXTURE : SVG `<feTurbulence>` fractal noise, tinted and
//     blended over the node. TEXTURE is NOISE's fields with a coarser,
//     grayscale, multiply-blended read (a surface grain, not a color
//     grain).
//   - GLASS : the frosted-glass blur itself rides the SAME CSS
//     `backdrop-filter` as `backdropBlur` (folded together in
//     `UniversalWrapper`) ; what's added here is a directional highlight
//     gradient (`lightAngle` / `lightIntensity` / `splay`) standing in
//     for a specular reflection, since real refraction (bending what's
//     behind) isn't expressible in CSS at all. `refraction` / `depth` /
//     `dispersion` round-trip only, never rendered — same fidelity as
//     the Prism editor.
//
// R8 runtime gate : every value here can also arrive via a live LSDP
// delta that bypassed the compiler's clamp entirely, so every numeric
// field is re-validated/re-clamped at render, never trusted raw.

import { useId, type CSSProperties } from "react";
import { clampFilterChannel, clampUnitInterval, normalizeDegrees } from "./filter-clamp";

export interface NoiseProps {
  noiseSize: number;
  noiseSizeVector?: { x: number; y: number };
  noiseType: "MONOTONE" | "MULTITONE" | "DUOTONE";
  density: number;
  color?: { r: number; g: number; b: number; a: number };
  secondaryColor?: { r: number; g: number; b: number; a: number };
}

export interface TextureProps {
  radius: number;
  noiseSize: number;
  noiseSizeVector?: { x: number; y: number };
  clipToShape?: boolean;
}

export interface GlassProps {
  radius: number;
  refraction: number;
  depth: number;
  lightAngle: number;
  lightIntensity: number;
  dispersion: number;
  splay: number;
}

export interface EffectOverlaysProps {
  noise?: NoiseProps;
  texture?: TextureProps;
  glass?: GlassProps;
}

export function EffectOverlays({ noise, texture, glass }: EffectOverlaysProps) {
  const baseId = useId();
  if (!noise && !texture && !glass) return null;
  return (
    <>
      {noise && <GrainOverlay kind="noise" effect={noise} filterId={`${baseId}-noise`} />}
      {texture && <GrainOverlay kind="texture" effect={texture} filterId={`${baseId}-texture`} />}
      {glass && <GlassHighlight effect={glass} />}
    </>
  );
}

function rgbaFromUnit(
  c: { r: number; g: number; b: number; a: number } | undefined,
  fallback: string,
): string {
  if (!c) return fallback;
  const r = Math.round((clampUnitInterval(c.r) ?? 0) * 255);
  const g = Math.round((clampUnitInterval(c.g) ?? 0) * 255);
  const b = Math.round((clampUnitInterval(c.b) ?? 0) * 255);
  const a = clampUnitInterval(c.a) ?? 0;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

function GrainOverlay({
  kind,
  effect,
  filterId,
}: {
  kind: "noise" | "texture";
  effect: NoiseProps | TextureProps;
  filterId: string;
}) {
  const isTexture = kind === "texture";
  const rawSize = isTexture ? (effect as TextureProps).noiseSize : (effect as NoiseProps).noiseSize;
  const size = Math.max(0.5, clampFilterChannel("noiseSize", rawSize) ?? 0.5);
  // Bigger noiseSize → coarser grain → LOWER turbulence frequency.
  const baseFrequency = clampUnitInterval(1 / (size * (isTexture ? 6 : 2.5))) ?? 0;
  const noiseType = isTexture ? "MONOTONE" : (effect as NoiseProps).noiseType;
  const monotone = isTexture || noiseType === "MONOTONE";
  const duotone = !isTexture && noiseType === "DUOTONE";

  const density = isTexture ? 0.4 : (clampUnitInterval((effect as NoiseProps).density) ?? 0);
  const tint = !isTexture
    ? rgbaFromUnit((effect as NoiseProps).color, "rgba(255,255,255,0.7)")
    : undefined;
  const secondaryTint =
    duotone && !isTexture
      ? rgbaFromUnit((effect as NoiseProps).secondaryColor, "rgba(0,0,0,0.7)")
      : undefined;

  return (
    <>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          {/* Explicit 0/0/100%/100% filter region — SVG filters default
           * to a -10%/-10%/120%/120% bounding box, which visibly bleeds
           * the turbulence noise past the node's own edges. */}
          <filter id={filterId} x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency={baseFrequency}
              numOctaves={isTexture ? 3 : 2}
              seed={7}
              stitchTiles="stitch"
              result="turb"
            />
            {/* Collapse the RGB channels to a single alpha-only greyscale
             * field — MONOTONE/TEXTURE paints a flat tint through that
             * alpha ; DUOTONE/MULTITONE paints a two-color gradient
             * overlay clipped by the same alpha via the wrapper's
             * `background` below. */}
            <feColorMatrix
              in="turb"
              type="matrix"
              values={
                monotone
                  ? "0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.35 0.35 0.35 0 0"
                  : "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0.35 0.35 0.35 0 0"
              }
            />
          </filter>
        </defs>
      </svg>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          filter: `url(#${filterId})`,
          opacity: density,
          mixBlendMode: isTexture ? "multiply" : monotone ? "overlay" : "normal",
          background: monotone
            ? tint
            : secondaryTint
              ? `linear-gradient(135deg, ${tint}, ${secondaryTint})`
              : tint,
        }}
      />
    </>
  );
}

function GlassHighlight({ effect }: { effect: GlassProps }) {
  const angle = normalizeDegrees(effect.lightAngle);
  const intensity = clampUnitInterval(effect.lightIntensity) ?? 0;
  if (intensity <= 0) return null;
  // `splay` widens the highlight band ; 0 = a tight streak, 1 = a soft
  // wash across most of the node.
  const spread = 15 + (clampUnitInterval(effect.splay) ?? 0) * 45;
  const style: CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    background: `linear-gradient(${angle}deg, rgba(255,255,255,${(intensity * 0.5).toFixed(3)}) 0%, transparent ${spread}%, transparent ${100 - spread}%, rgba(0,0,0,${(intensity * 0.15).toFixed(3)}) 100%)`,
    mixBlendMode: "overlay",
  };
  return <div aria-hidden="true" style={style} />;
}
