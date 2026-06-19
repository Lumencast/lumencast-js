// Exhaustive render↔ref + bundle↔Figma comparison. Writes NUMBERED artifacts to
// lumencast-figma/.local-exports/compare/ so each can be inspected in order.
//
//   01-render.png         our Solar render (1920×1080)
//   02-ref.png            Figma reference  (1920×1080)
//   03-diff-overlay.png   render XOR ref (difference blend): black = identical
//   04-diff-amplified.png  same, brightness×6 — subtle deltas pop
//   05-pixel-stats.txt    % differing pixels, per 8×8 grid cell
//
//   node compare.mjs
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORTS = "D:/Documents/Lumencast/lumencast-figma/.local-exports";
// A NEW numbered folder per run — nothing is overwritten, every iteration
// (and every regression) stays visible: tests/test-01, test-02, …
const ROOT = `${EXPORTS}/tests`;
mkdirSync(ROOT, { recursive: true });
const existing = readdirSync(ROOT)
  .map((d) => /^test-(\d+)$/.exec(d))
  .filter(Boolean)
  .map((m) => Number(m[1]));
const N = (existing.length ? Math.max(...existing) : 0) + 1;
const OUT = `${ROOT}/test-${String(N).padStart(2, "0")}`;
mkdirSync(OUT, { recursive: true });

const renderPath = `${EXPORTS}/render-817-3.png`;
const refPath = `${EXPORTS}/ref-817-3.png`;
copyFileSync(renderPath, `${OUT}/01-render.png`);
copyFileSync(refPath, `${OUT}/02-ref.png`);

const renderB64 = readFileSync(renderPath).toString("base64");
const refB64 = readFileSync(refPath).toString("base64");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

// --- pixel-exact diff via canvas getImageData ---
const html = `<!doctype html><html><head><style>html,body{margin:0;padding:0}</style></head>
<body>
<canvas id="c" width="1920" height="1080"></canvas>
<img id="r" src="data:image/png;base64,${renderB64}">
<img id="f" src="data:image/png;base64,${refB64}">
</body></html>`;
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode())));

const stats = await page.evaluate(() => {
  const r = document.getElementById("r");
  const f = document.getElementById("f");
  const c = document.getElementById("c");
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(r, 0, 0, 1920, 1080);
  const rd = g.getImageData(0, 0, 1920, 1080).data;
  g.clearRect(0, 0, 1920, 1080);
  g.drawImage(f, 0, 0, 1920, 1080);
  const fd = g.getImageData(0, 0, 1920, 1080).data;

  const W = 1920, H = 1080;
  const diff = new Uint8ClampedArray(W * H * 4);
  let changed = 0, total = W * H;
  // 8 cols × 6 rows grid of % difference
  const GX = 8, GY = 6;
  const cell = Array.from({ length: GY }, () => Array(GX).fill(0));
  const cellN = (W / GX) * (H / GY);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const dr = Math.abs(rd[o] - fd[o]);
    const dg = Math.abs(rd[o + 1] - fd[o + 1]);
    const db = Math.abs(rd[o + 2] - fd[o + 2]);
    const d = dr + dg + db;
    diff[o] = dr; diff[o + 1] = dg; diff[o + 2] = db; diff[o + 3] = 255;
    if (d > 24) {
      changed++;
      const x = i % W, y = (i / W) | 0;
      const gx = Math.min(GX - 1, (x / (W / GX)) | 0);
      const gy = Math.min(GY - 1, (y / (H / GY)) | 0);
      cell[gy][gx]++;
    }
  }
  // write diff image to canvas + return data URL
  g.putImageData(new ImageData(diff, W, H), 0, 0);
  const overlay = c.toDataURL("image/png");
  // amplified
  for (let i = 0; i < diff.length; i += 4) {
    diff[i] = Math.min(255, diff[i] * 6);
    diff[i + 1] = Math.min(255, diff[i + 1] * 6);
    diff[i + 2] = Math.min(255, diff[i + 2] * 6);
  }
  g.putImageData(new ImageData(diff, W, H), 0, 0);
  const amplified = c.toDataURL("image/png");

  const grid = cell.map((row) => row.map((n) => ((100 * n) / cellN).toFixed(1).padStart(5)).join(" ")).join("\n");
  return { changedPct: ((100 * changed) / total).toFixed(2), grid, overlay, amplified };
});

writeFileSync(`${OUT}/03-diff-overlay.png`, Buffer.from(stats.overlay.split(",")[1], "base64"));
writeFileSync(`${OUT}/04-diff-amplified.png`, Buffer.from(stats.amplified.split(",")[1], "base64"));
writeFileSync(
  `${OUT}/05-pixel-stats.txt`,
  `Pixels differing (|ΔR|+|ΔG|+|ΔB| > 24): ${stats.changedPct}%\n\n` +
    `Per-cell % differing (8 cols × 6 rows, render vs ref):\n${stats.grid}\n`,
);

console.log("[compare] pixels differing:", stats.changedPct + "%");
console.log("[compare] grid (% per cell):\n" + stats.grid);
await browser.close();

// ---------------------------------------------------------------------------
// NUMERIC conformance : every node's geometry vs Figma's ground truth.
// Matched by parallel tree-walk (name + order). Flags ANY delta ≥ 1px / ≥ 0.1°
// / any pathData char. Figma is authoritative.
// ---------------------------------------------------------------------------
const FILE = "gtCekQzHW0eBqx4ATVRAAw";
const TOKEN = process.env.FIGMA_REST_TOKEN;
const RAW = `${ROOT}/figma-raw.json`;
let figDoc;
try {
  figDoc = JSON.parse(readFileSync(RAW, "utf8"));
} catch {
  if (!TOKEN) throw new Error("FIGMA_REST_TOKEN not set and no cached figma-raw.json");
  const res = await fetch(`https://api.figma.com/v1/files/${FILE}/nodes?ids=817:3&geometry=paths`, {
    headers: { "X-Figma-Token": TOKEN },
  });
  figDoc = await res.json();
  writeFileSync(RAW, JSON.stringify(figDoc));
}
const figRoot = Object.values(figDoc.nodes)[0].document;

const r3 = (n) => Math.round(n * 1000) / 1000;
const n_isPath = (n) => n.geometry === "path" || n.pathData !== undefined || Array.isArray(n.paths);
const figFields = (n) => {
  const bb = n.absoluteBoundingBox || {};
  const sz = n.size || {};
  return {
    name: n.name,
    type: n.type,
    absX: bb.x, absY: bb.y, aabbW: bb.width, aabbH: bb.height,
    sizeW: sz.x, sizeH: sz.y,
    rot: n.rotation !== undefined ? r3((n.rotation * 180) / Math.PI) : 0,
    cr: n.cornerRadius,
    opacity: n.opacity ?? 1,
    visible: n.visible !== false,
    path: (n.fillGeometry || []).map((g) => g.path).join(" | ") || null,
  };
};
const bunFields = (n, absX, absY) => ({
  name: (n.metadata && n.metadata.figma && n.metadata.figma.layerName) || "",
  kind: n.kind,
  absX, absY,
  w: n.size ? n.size.w : undefined, h: n.size ? n.size.h : undefined,
  rot: n.rotation ?? 0,
  cr: n.cornerRadius,
  opacity: n.opacity ?? 1,
  visible: n.visible !== false,
  path: n.pathData || (n.paths ? n.paths.map((p) => p.data).join(" | ") : null),
});

const gaps = [];
const note = (path, field, fig, our) => gaps.push(`${path} | ${field}: figma=${fig} ours=${our}`);

function compare(fig, bun, path, accX, accY) {
  const f = figFields(fig);
  const px = accX + ((bun.position && bun.position.x) || 0);
  const py = accY + ((bun.position && bun.position.y) || 0);
  const b = bunFields(bun, px, py);
  const id = `${path}/${f.name}`;
  // position — compare CENTRES (rotation-invariant). Figma's absoluteBoundingBox
  // is the AABB ; our box is the unrotated box anchored on the same centre, so
  // top-lefts legitimately differ for rotated nodes but centres must match.
  if (f.absX !== undefined && f.aabbW !== undefined && b.w !== undefined) {
    const fcx = f.absX + f.aabbW / 2, bcx = b.absX + b.w / 2;
    const fcy = f.absY + f.aabbH / 2, bcy = b.absY + b.h / 2;
    if (Math.abs(fcx - bcx) >= 1) note(id, "cx", r3(fcx), r3(bcx));
    if (Math.abs(fcy - bcy) >= 1) note(id, "cy", r3(fcy), r3(bcy));
  }
  // size — our size vs Figma UNROTATED size (sizeW) when present, else AABB
  const fw = f.sizeW ?? f.aabbW, fh = f.sizeH ?? f.aabbH;
  if (b.w !== undefined && fw !== undefined && Math.abs(fw - b.w) >= 1) note(id, "w", r3(fw), r3(b.w));
  if (b.h !== undefined && fh !== undefined && Math.abs(fh - b.h) >= 1) note(id, "h", r3(fh), r3(b.h));
  if (Math.abs((f.rot || 0) - (b.rot || 0)) >= 0.1) note(id, "rot", f.rot, b.rot);
  if ((f.cr ?? 0) !== (b.cr ?? 0) && Math.abs((f.cr ?? 0) - (b.cr ?? 0)) >= 0.5) note(id, "cornerRadius", f.cr, b.cr);
  if (Math.abs((f.opacity ?? 1) - (b.opacity ?? 1)) >= 0.01) note(id, "opacity", f.opacity, b.opacity);
  if (f.visible !== b.visible) note(id, "visible", f.visible, b.visible);
  // pathData only matters for real vector shapes (Figma emits a bounding-rect
  // fillGeometry for every frame/image too — not a gap). Compare only when WE
  // model the node as a path shape.
  if (b.kind === "shape" && n_isPath(bun)) {
    if (f.path && b.path && f.path.replace(/\s+/g, "") !== b.path.replace(/\s+/g, "")) note(id, "pathData", "≠ (" + f.path.length + " chars)", "(" + (b.path ? b.path.length : 0) + " chars)");
    if (f.path && !b.path) note(id, "pathData", "present", "MISSING");
  }

  // recurse — coord origin for children: Figma children x/y are absolute too,
  // so accumulate our relative positions. Match children by name + order.
  const figCh = (fig.children || []).filter((c) => c.type !== "VECTOR" || true);
  const bunCh = bun.children || [];
  const used = new Set();
  for (const fc of figCh) {
    let bi = bunCh.findIndex((c, i) => !used.has(i) && ((c.metadata && c.metadata.figma && c.metadata.figma.layerName) || "") === fc.name);
    if (bi === -1) { gaps.push(`${id} | child MISSING in bundle: "${fc.name}" (${fc.type})`); continue; }
    used.add(bi);
    compare(fc, bunCh[bi], id, px, py);
  }
  for (let i = 0; i < bunCh.length; i++)
    if (!used.has(i)) gaps.push(`${id} | extra in bundle: "${(bunCh[i].metadata && bunCh[i].metadata.figma && bunCh[i].metadata.figma.layerName) || "?"}" (${bunCh[i].kind})`);
}

compare(figRoot, bundleLayout(), "", 0, 0);
function bundleLayout() {
  return JSON.parse(readFileSync(`${EXPORTS}/cover-817-3.lsml.json`, "utf8")).layout;
}

writeFileSync(`${OUT}/06-numeric-gaps.txt`, `${gaps.length} gaps (≥1px / ≥0.1° / pathData / presence) vs Figma 817:3\n\n${gaps.join("\n")}\n`);
console.log(`[compare] numeric gaps vs Figma: ${gaps.length} → ${OUT}/06-numeric-gaps.txt`);
console.log("[compare] wrote", OUT);
process.exit(0);
