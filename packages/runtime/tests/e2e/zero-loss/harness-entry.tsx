// Zero-loss render harness entry (ADR 002 #J / RC#10).
//
// Renders the `817:3` cover bundle through the PRODUCTION render path
// (`BroadcastMode` = `AllowedHostsProvider` + `ShapeIndexProvider` + `<Tree>`)
// into a fixed 1920×1080 stage, with NO WS server and NO mode crossfade — so a
// Playwright screenshot is deterministic and settled. It is the headless render
// arm of the round-trip:
//
//   817:3 (Figma) → mapper → LSML 1.2 (committed fixture) → compileBundle →
//   RenderBundle → THIS render → screenshot → SSIM.
//
// Asset resolution: the committed fixture's image `src`s are content-addressed
// placeholders (`assets/<name>.png`) or 12-byte stub `data:` URIs that don't
// decode. A real broadcast host resolves those via its asset pipeline. Here the
// harness plays that host role: it rewrites every asset reference to a bounded,
// per-node-DISTINCT `data:image/png;base64,…` swatch so (a) the allowlist gate
// (`data:image/*` passes, `[]` allowedHosts stays coherent — Bastion T6) is
// exercised unchanged, and (b) each promoted family paints a distinguishable
// region the spec can assert on. The swatches are deterministic (fixed colour
// table) → bit-stable screenshots.

import { createRoot } from "react-dom/client";
import { createElement, StrictMode } from "react";
import { createStore } from "../../../src/state/store";
import { BroadcastMode } from "../../../src/modes/broadcast";
import { LumencastRuntimeProvider } from "../../../src/overlay/runtime-context";
import { compileBundle } from "../../../../compiler/src/index";
import type { LSMLBundle } from "../../../../compiler/src/index";
import { rewriteLayoutSrcs, rewriteDefaultsSrcs, type AssetTable } from "./asset-resolver";
import fixture from "./fixtures/cover-817-3.lsml.json";

// Deterministic 1×1 PNG data URIs, one solid colour per asset. A 1×1 image
// scaled by `object-fit: cover` fills its box with the solid colour, giving
// each promoted node a flat, distinguishable swatch. Built lazily (the PNG
// helpers below are hoisted as functions but `CRC_TABLE` is a `const` in the
// temporal dead zone at module-eval time — so we memoise on first call).
const SWATCH_COLOURS: Record<string, [number, number, number]> = {
  ruby20: [220, 40, 90], // Ruby20 image (blend hard-light)
  render3d: [40, 200, 120], // 3d render image-fill in vector
  ellipse: [255, 255, 255], // ellipse alpha mask source
  wavy: [60, 120, 240], // wavy masked image (blend hard-light)
};

const swatchCache: Record<string, string> = {};
function swatch(name: string): string | undefined {
  const rgb = SWATCH_COLOURS[name];
  if (!rgb) return undefined;
  return (swatchCache[name] ??= solidPng(rgb[0], rgb[1], rgb[2]));
}

/** The toy fixture's content-addressed `assets/<name>.png` refs map to named
 *  swatches; the asset-resolver applies this table to layout + defaults. Built
 *  lazily (inside `main`, after the TDZ-safe microtask defer) because `swatch()`
 *  reaches the `CRC_TABLE` const at the bottom of the module. */
function swatchTable(): AssetTable {
  return Object.fromEntries(
    Object.keys(SWATCH_COLOURS).map((name) => [`assets/${name}.png`, swatch(name)!]),
  );
}

/** A 1×1 opaque PNG of the given RGB, base64-encoded as a bounded data URI.
 *  Hand-built (no encoder dep): PNG signature + IHDR + IDAT(zlib stored) +
 *  IEND, with correct CRC32s. */
function solidPng(r: number, g: number, b: number): string {
  const bytes = buildSolidPng(r, g, b);
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(bin)}`;
}

/** Map the toy fixture's known undecodable inline-stub `data:` URI to a swatch
 *  (the named `assets/<name>.png` refs are handled by the shared resolver). */
function rewriteStubDataUris(node: unknown): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) rewriteStubDataUris(n);
    return;
  }
  const obj = node as Record<string, unknown>;
  const s = obj["src"];
  if (typeof s === "string" && s.startsWith("data:image/png;base64,iVBORw0KGgoBAgME")) {
    obj["src"] = swatch("render3d");
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") rewriteStubDataUris(v);
  }
}

function main(): void {
  const bundle = structuredClone(fixture) as LSMLBundle & {
    defaults?: Record<string, unknown>;
  };

  // Resolve content-addressed `assets/<name>.png` refs (layout + defaults) to
  // their swatch data-URIs via the shared resolver, then map the inline stub.
  const table = swatchTable();
  rewriteLayoutSrcs(bundle.layout, table);
  rewriteStubDataUris(bundle.layout);
  const defaults = rewriteDefaultsSrcs(
    { ...((bundle.defaults as Record<string, unknown>) ?? {}) },
    table,
  );

  const compiled = compileBundle(bundle, {
    onWarn: (m) => console.warn("[harness:compile]", m),
  });

  const store = createStore();
  store.reset(defaults);

  const target = document.getElementById("scene");
  if (!(target instanceof HTMLElement)) throw new Error("harness: #scene missing");

  const root = createRoot(target);
  root.render(
    createElement(
      StrictMode,
      null,
      createElement(
        LumencastRuntimeProvider,
        {
          value: {
            mode: "broadcast",
            store,
            bundle: compiled,
            status: "live",
            sendInput: () => {},
          },
        },
        createElement(BroadcastMode),
      ),
    ),
  );

  // Signal readiness for the Playwright spec (after a frame so layout settles).
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      (window as unknown as { __harnessReady: boolean }).__harnessReady = true;
    });
  });
}

// Defer to a microtask so every `const` below (CRC_TABLE) is initialised
// before `main()` reaches the PNG encoder — avoids a temporal-dead-zone throw.
queueMicrotask(main);

// ---- minimal PNG encoder (solid 1×1) ----

function buildSolidPng(r: number, g: number, b: number): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  // IHDR: 1×1, 8-bit, colour type 2 (truecolour).
  const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  // Raw image data: one scanline, filter byte 0 + RGB.
  const raw = new Uint8Array([0, r, g, b]);
  const idat = zlibStore(raw);
  const chunks = [chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = sig.length + chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  out.set(sig, 0);
  let off = sig.length;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([...type].map((c) => c.charCodeAt(0)));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const len = data.length;
  const out = new Uint8Array(4 + body.length + 4);
  out[0] = (len >>> 24) & 0xff;
  out[1] = (len >>> 16) & 0xff;
  out[2] = (len >>> 8) & 0xff;
  out[3] = len & 0xff;
  out.set(body, 4);
  const crc = crc32(body);
  out[4 + body.length] = (crc >>> 24) & 0xff;
  out[5 + body.length] = (crc >>> 16) & 0xff;
  out[6 + body.length] = (crc >>> 8) & 0xff;
  out[7 + body.length] = crc & 0xff;
  return out;
}

/** zlib "stored" (uncompressed) wrapper around raw bytes. */
function zlibStore(data: Uint8Array): Uint8Array {
  const len = data.length;
  const out = new Uint8Array(2 + 5 + len + 4);
  out[0] = 0x78; // CMF
  out[1] = 0x01; // FLG (no dict, fastest)
  out[2] = 0x01; // BFINAL=1, BTYPE=00 (stored)
  out[3] = len & 0xff;
  out[4] = (len >>> 8) & 0xff;
  out[5] = ~len & 0xff;
  out[6] = (~len >>> 8) & 0xff;
  out.set(data, 7);
  const adler = adler32(data);
  out[7 + len] = (adler >>> 24) & 0xff;
  out[8 + len] = (adler >>> 16) & 0xff;
  out[9 + len] = (adler >>> 8) & 0xff;
  out[10 + len] = adler & 0xff;
  return out;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
