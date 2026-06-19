// Standalone real-817:3 render: Vite (HTTPS) dev server + Playwright screenshot.
// Renders the genuine REST-imported bundle through production BroadcastMode and
// writes a 1920×1080 PNG. Re-runnable; nothing committed-asset-heavy.
//
//   node tests/e2e/zero-loss/real/render.mjs [outPath]

import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, copyFileSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Always serve the FRESHLY generated bundle + assets (ln -s copies-and-freezes
// on Git-Bash/Windows, so copy explicitly each run).
const EXPORTS = "D:/Documents/Lumencast/lumencast-figma/.local-exports";
copyFileSync(`${EXPORTS}/cover-817-3.lsml.json`, resolve(__dirname, "bundle.json"));
rmSync(resolve(__dirname, "assets"), { recursive: true, force: true });
mkdirSync(resolve(__dirname, "assets"), { recursive: true });
for (const f of readdirSync(`${EXPORTS}/assets`))
  copyFileSync(`${EXPORTS}/assets/${f}`, resolve(__dirname, "assets", f));
const RUNTIME_ROOT = resolve(__dirname, "../../../.."); // packages/runtime
const OUT =
  process.argv[2] ??
  "D:/Documents/Lumencast/lumencast-figma/.local-exports/render-817-3.png";
const PORT = 5219;

const server = await createServer({
  root: RUNTIME_ROOT,
  configFile: false,
  logLevel: "warn",
  plugins: [react()],
  server: {
    port: PORT,
    strictPort: true,
    https: {
      key: readFileSync(resolve(__dirname, "certs/key.pem")),
      cert: readFileSync(resolve(__dirname, "certs/cert.pem")),
    },
    fs: { allow: ["D:/Documents/Lumencast/lumencast-js", "D:/Documents/Lumencast/lumencast-figma"] },
  },
});
await server.listen();
const url = `https://localhost:${PORT}/tests/e2e/zero-loss/harness-real.html`;
console.log("[render] serving", url);

const browser = await chromium.launch();
// deviceScaleFactor 2 : render the scene at 3840×2160 then downsample to
// 1920×1080 (below). Figma's PNG export is supersampled (smooth AA at every
// edge) ; a 1× Chromium grab is rougher, which alone cost ~0.9% of pixel diff
// at text / vector / image-ridge edges — a render-QUALITY gap, not a
// transcription error. Supersampling is the honest fix (the antenne's CEF can
// be configured high-DPI to match). 2× is the sweet spot ; 3× timed out on the
// glow/blur raster for no measurable extra gain.
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  ignoreHTTPSErrors: true,
});
const page = await ctx.newPage();
const warnings = [];
page.on("console", (m) => {
  if (m.type() === "warning" || m.type() === "error") warnings.push(m.text());
});
page.on("pageerror", (e) => warnings.push("PAGEERROR: " + e.message));

await page.goto(url, { waitUntil: "load", timeout: 60_000 });
try {
  await page.waitForFunction(() => window.__harnessReady === true, { timeout: 60_000 });
} catch {
  console.error("[render] harness did not signal ready");
}
await page.waitForTimeout(800);
// Grab at 2× (→ 3840×2160 device px), then downsample to 1920×1080 with a
// high-quality canvas filter — supersampled AA that matches Figma's export.
const superBuf = await page
  .locator("#scene")
  .screenshot({ clip: { x: 0, y: 0, width: 1920, height: 1080 }, timeout: 180_000, animations: "disabled" });
const dsCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const dsPage = await dsCtx.newPage();
await dsPage.setContent(
  `<canvas id=dz width=1920 height=1080></canvas><img id=src src="data:image/png;base64,${superBuf.toString("base64")}">`,
);
await dsPage.evaluate(() => document.getElementById("src").decode());
const outB64 = await dsPage.evaluate(() => {
  const c = document.getElementById("dz");
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(document.getElementById("src"), 0, 0, 1920, 1080);
  return c.toDataURL("image/png").split(",")[1];
});
writeFileSync(OUT, Buffer.from(outB64, "base64"));
await dsCtx.close();
console.log("[render] wrote", OUT, "(2× supersampled → 1920×1080)");

// --- DOM inspection : the actual generated <mask> elements + their application ---
const maskInfo = await page.evaluate(() => {
  const out = { masks: [], maskedEls: [] };
  for (const m of Array.from(document.querySelectorAll("mask"))) {
    const svg = m.closest("svg");
    out.masks.push({
      id: m.id,
      maskUnits: m.getAttribute("maskUnits"),
      maskContentUnits: m.getAttribute("maskContentUnits"),
      childTags: Array.from(m.children).map((c) => c.tagName),
      html: m.outerHTML.slice(0, 240),
      svgSize: svg ? `${svg.getAttribute("width")}x${svg.getAttribute("height")}` : "no-svg",
    });
  }
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const cs = getComputedStyle(el);
    const mask = cs.mask && cs.mask !== "none" ? cs.mask : cs.webkitMaskImage;
    if (mask && mask !== "none" && /url\(/.test(mask)) {
      const r = el.getBoundingClientRect();
      out.maskedEls.push({
        tag: el.tagName,
        mask: mask.slice(0, 80),
        rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
      });
    }
  }
  return out;
});
void maskInfo;

const probe = await page.evaluate(() => {
  const imgs = Array.from(document.querySelectorAll("img")).map((im) => {
    const r = im.getBoundingClientRect();
    return {
      src: (im.getAttribute("src") || "").slice(-44),
      loaded: im.complete && im.naturalWidth > 0,
      nat: `${im.naturalWidth}x${im.naturalHeight}`,
      rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
    };
  });
  // topmost element stack at a few scene points
  const stackAt = (x, y) =>
    document
      .elementsFromPoint(x, y)
      .slice(0, 4)
      .map((e) => {
        const cs = getComputedStyle(e);
        return `${e.tagName}.${(e.className || "").toString().slice(0, 12)}[bg=${cs.backgroundColor.slice(0, 18)}]`;
      });
  // does the logo/wordmark render? count white-ish SVG paths in the Main area
  const svgPaths = Array.from(document.querySelectorAll("svg path")).length;
  const texts = Array.from(document.querySelectorAll("*"))
    .filter((e) => e.childNodes.length === 1 && e.firstChild?.nodeType === 3 && e.textContent.trim())
    .map((e) => e.textContent.trim().slice(0, 20))
    .slice(0, 10);
  return {
    imgs,
    center: stackAt(960, 400),
    logoArea: stackAt(420, 470),
    svgPathCount: svgPaths,
    texts,
  };
});
console.log("[probe]", JSON.stringify(probe, null, 1).slice(0, 2200));

const order = await page.evaluate(() => {
  const scene = document.getElementById("scene");
  const classify = (el) => {
    const hasImg = el.querySelector("img") ? "IMG" : "";
    const hasPaths = el.querySelectorAll("svg path").length;
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24);
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return `${hasImg}${hasPaths ? " paths=" + hasPaths : ""} z=${cs.zIndex} blend=${cs.mixBlendMode} pos=${cs.position} rect=${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} ${txt ? "txt='" + txt + "'" : ""}`;
  };
  // walk into the single wrapper chain until we hit the real multi-child layer
  let layer = scene;
  while (layer && layer.children.length === 1) layer = layer.children[0];
  return Array.from(layer?.children || []).map((c, i) => `[${i}] ${c.tagName} ${classify(c)}`);
});
console.log("[scene-children]\n" + order.join("\n"));

const logo = await page.evaluate(() => {
  // Main block = the absolutely-placed div at 169,308 835x393
  const all = Array.from(document.querySelectorAll("div"));
  const main = all.find((d) => {
    const r = d.getBoundingClientRect();
    return Math.abs(r.x - 169) < 3 && Math.abs(r.y - 308) < 3 && Math.round(r.width) === 835;
  });
  if (!main) return { found: false };
  const cs = getComputedStyle(main);
  const paths = Array.from(main.querySelectorAll("path")).slice(0, 5).map((p) => {
    const ps = getComputedStyle(p);
    let bb = null;
    try {
      const b = p.getBBox();
      bb = `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`;
    } catch {
      /* getBBox throws on non-rendered / detached nodes — leave bbox null */
    }
    const r = p.getBoundingClientRect();
    return { fill: ps.fill, opacity: ps.opacity, display: ps.display, bbox: bb, screen: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` };
  });
  // the <svg> wrapping the paths : its viewBox / size / position
  const svgs = Array.from(main.querySelectorAll("svg")).slice(0, 3).map((s) => {
    const r = s.getBoundingClientRect();
    return { vb: s.getAttribute("viewBox"), wh: `${s.getAttribute("width")}x${s.getAttribute("height")}`, screen: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`, cssPos: getComputedStyle(s).position };
  });
  return { found: true, mainOpacity: cs.opacity, mainOverflow: cs.overflow, mainBlend: cs.mixBlendMode, mainClip: cs.clipPath, paths, svgs };
});
console.log("[logo]", JSON.stringify(logo, null, 1).slice(0, 1800));
if (warnings.length) {
  console.log("[render] page console (first 25):");
  for (const w of warnings.slice(0, 25)) console.log("   ", w.slice(0, 200));
}

await browser.close();
await server.close();
process.exit(0);
