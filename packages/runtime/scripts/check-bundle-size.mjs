// Verifies that Lumencast's per-mode chunks honour the size budget
// declared in chantier-lumencast-js.md and that the broadcast chunk does
// not pull in any overlay (control / test / status-pill) code.
//
// Run after `npm run build`. Exits non-zero on any violation —
// designed to be wired into CI as a separate step.

import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, join } from "node:path";

const DIST = resolve(import.meta.dirname, "..", "dist");

// Per-mode budgets, gzipped, in bytes.
const BROADCAST_BUDGET = 200 * 1024;
const CONTROL_BUDGET = 280 * 1024;
const TEST_BUDGET = 360 * 1024;

const files = readdirSync(DIST).filter((f) => f.endsWith(".js"));
const fileMap = new Map(); // basename prefix → { full, raw, gzip }
for (const f of files) {
  const buf = readFileSync(join(DIST, f));
  const gzip = gzipSync(buf).length;
  // strip the hash suffix to get the source name (e.g.
  // broadcast-CcsEAg11.js → broadcast). Vite default hash is 8 chars
  // (alphanumeric + dash), so match exactly that to avoid eating "-pill"
  // from "status-pill".
  const prefix = f.replace(/-[A-Za-z0-9_-]{8}\.js$/, "").replace(/\.js$/, "");
  fileMap.set(prefix, { full: f, raw: buf.length, gzip });
}

function need(prefix) {
  const entry = fileMap.get(prefix);
  if (!entry) {
    fail(`expected dist chunk for "${prefix}" — not found`);
  }
  return entry;
}

const errors = [];
function fail(msg) {
  errors.push(msg);
}

const lumencast = need("lumencast");
const indexShared = need("index");
const tree = need("tree");
const broadcast = need("broadcast");
const control = need("control");
const test = need("test");
const statusPill = need("status-pill");

// --- Per-mode bundle weights ---------------------------------------

const broadcastBundle = lumencast.gzip + indexShared.gzip + tree.gzip + broadcast.gzip;
const controlBundle = broadcastBundle + control.gzip + statusPill.gzip;
const testBundle = controlBundle + test.gzip;

console.log("lumencast runtime — chunk sizes");
console.log(
  "  broadcast  : %d B raw / %d B gz (sum)",
  lumencast.raw + indexShared.raw + tree.raw + broadcast.raw,
  broadcastBundle,
);
console.log(
  "  control    : %d B raw / %d B gz (sum)",
  lumencast.raw + indexShared.raw + tree.raw + broadcast.raw + control.raw + statusPill.raw,
  controlBundle,
);
console.log(
  "  test       : %d B raw / %d B gz (sum)",
  lumencast.raw +
    indexShared.raw +
    tree.raw +
    broadcast.raw +
    control.raw +
    statusPill.raw +
    test.raw,
  testBundle,
);

if (broadcastBundle > BROADCAST_BUDGET) {
  fail(`broadcast bundle ${broadcastBundle} B gz > ${BROADCAST_BUDGET} B budget`);
}
if (controlBundle > CONTROL_BUDGET) {
  fail(`control bundle ${controlBundle} B gz > ${CONTROL_BUDGET} B budget`);
}
if (testBundle > TEST_BUDGET) {
  fail(`test bundle ${testBundle} B gz > ${TEST_BUDGET} B budget`);
}

// --- Broadcast chunk does not import overlay chunks ---------------

const broadcastSource = readFileSync(join(DIST, broadcast.full), "utf8");

// The chunk's import statements reference the chunks it depends on
// by relative URL. We can grep for the basename of the forbidden
// chunks. If broadcast imports any of them, it's a tree-shake leak.
const FORBIDDEN_FOR_BROADCAST = ["control", "test", "status-pill"];
for (const forbidden of FORBIDDEN_FOR_BROADCAST) {
  const ref = fileMap.get(forbidden);
  if (!ref) continue;
  // Looking for an import like `from"./control-XXXXX.js"` or similar.
  if (broadcastSource.includes(ref.full)) {
    fail(`broadcast chunk references "${ref.full}" — overlay code leaked into broadcast mode`);
  }
}

// --- Done ---------------------------------------------------------

if (errors.length > 0) {
  console.error("\nbundle-size check FAILED :");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}

console.log("\nbundle-size check OK");
