// RC3 (ADR 003) — static guard: the headless render path performs NO network
// fetch. `renderBundleHeadless` and the public asset-resolution helpers must
// never reach the network on their own behalf; the host owns where bytes come
// from, and the deny-by-default host-allow gate stays the sole authority
// (Bastion R2 — a fetch in the published runtime would be an SSRF surface).
//
// We scan the two public headless modules for forbidden network primitives
// AFTER stripping comments and string/template literals, so the (heavily
// documented) no-fetch contract comments do not trip the guard. Run in CI as a
// dedicated step; exits non-zero on any violation.
//
// SCOPE — this is an anti-regression guard on TWO modules only
// (`headless.tsx` + `asset-resolve.ts`); it is NOT a proof of hermeticity.
// The real network invariant is `gateSrc` (deny-by-default host-allow) applied
// at EVERY asset leaf that places an untrusted URL into the DOM — image,
// image-fill, mask AND media (the latter added with ADR 003: a `<video src>`
// is just as much a fetch trigger as an `<img src>`). A new leaf with a network
// sink must route through `gateSrc`; this script will not catch it if it does
// not, so the gate — not this guard — is the authority.

import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

// The modules that make up the no-fetch headless surface (ADR 003 §3.1/§3.2).
const GUARDED = ["src/render/headless.tsx", "src/render/asset-resolve.ts"];

// Network primitives that must never appear in the headless render path.
// `import(` is allowed only for SAME-PACKAGE relative chunks (the BroadcastMode
// lazy import, ADR 003 §4 RC6) — a dynamic import of a remote/bare specifier
// would be a fetch in disguise, so we flag any `import(` whose argument is not a
// relative `./`/`../` path.
const FORBIDDEN = [
  { name: "fetch(", re: /\bfetch\s*\(/ },
  { name: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
  { name: "WebSocket", re: /\bnew\s+WebSocket\b/ },
  { name: "EventSource", re: /\bnew\s+EventSource\b/ },
  { name: "navigator.sendBeacon", re: /\bsendBeacon\s*\(/ },
  { name: "remote dynamic import()", re: /\bimport\s*\(\s*[`'"](?!\.\.?\/)/ },
];

/** Strip // line comments, /* block comments * / and string / template literals
 *  so identifiers inside prose or quoted text don't trip the scan. */
function stripCommentsAndStrings(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      out += " "; // keep token boundaries
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const errors = [];
for (const rel of GUARDED) {
  const file = resolve(ROOT, rel);
  const code = stripCommentsAndStrings(readFileSync(file, "utf8"));
  for (const { name, re } of FORBIDDEN) {
    if (re.test(code)) {
      errors.push(`${relative(ROOT, file)} contains forbidden network primitive: ${name}`);
    }
  }
}

if (errors.length > 0) {
  console.error("no-fetch guard FAILED (ADR 003 RC3):");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}

console.log("no-fetch guard OK — headless render path is network-free (ADR 003 RC3)");
console.log("  scanned:", GUARDED.join(", "));
