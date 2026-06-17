// Probe — host-allow adversarial + edge-case coverage (ADR 002 #C, issue #C).
// Bastion conditions T1 (exact hostname match) + T2 (scheme allowlist).
//
// This file COMPLEMENTS Forge's `host-allow.test.ts` — it does NOT duplicate
// its cases. It covers : control characters in URLs, HTTPS mixed-case, exact
// boundary of MAX_URL_LEN, trailing-dot hosts, IDN/punycode/unicode homoglyphs,
// localhost / 0.0.0.0, substrate-substring tricks Forge did not enumerate,
// allowlist with non-string entries, checkHostAllowed reason R9 on every
// rejection path, data: boundaries, and the space-trimming WHATWG URL behaviour.
//
// Refs ADR 002 #C.
// Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>

import { describe, expect, it } from "vitest";
import { isHostAllowed, checkHostAllowed } from "../src/index.js";

const ALLOWED = ["cdn.lumencast.dev", "assets.example.com"];

// ---------------------------------------------------------------------------
// Control characters / whitespace in URL (scheme-bypass attempts)
// ---------------------------------------------------------------------------
describe("T2 — control chars + whitespace in URL", () => {
  it("rejects \\t before javascript: (tab-prefixed hostile scheme)", () => {
    // WHATWG URL parser strips leading ASCII whitespace before parsing the scheme.
    // `\tjavascript:alert(1)` therefore parses with protocol "javascript:" and
    // MUST be rejected by the scheme check.
    expect(isHostAllowed("\tjavascript:alert(1)", ALLOWED)).toBe(false);
  });

  it("rejects \\n inside scheme ('java\\nscript:')", () => {
    // WHATWG URL parser strips C0 control chars from the scheme before
    // parsing — `java\nscript:` is normalised to `javascript:`.
    expect(isHostAllowed("java\nscript:alert(1)", ALLOWED)).toBe(false);
  });

  it("rejects \\r before javascript:", () => {
    expect(isHostAllowed("\rjavascript:alert(1)", ALLOWED)).toBe(false);
  });

  it("accepts an HTTPS url with leading whitespace (WHATWG strips it, hostname is correct)", () => {
    // The WHATWG URL parser strips leading ASCII whitespace → this resolves to
    // `https://cdn.lumencast.dev/a.png`. We document that the gate relies on
    // the parser and trusts its output; the hostname check then applies normally.
    expect(isHostAllowed("  https://cdn.lumencast.dev/a.png", ALLOWED)).toBe(true);
  });

  it("rejects leading-whitespace file: (still a hostile scheme after trimming)", () => {
    expect(isHostAllowed("  file:///etc/passwd", ALLOWED)).toBe(false);
  });

  it("rejects \\0 null byte in URL (malformed, rejected by URL parser)", () => {
    expect(isHostAllowed("https://cdn.lumencast.dev\x00.evil.com/a.png", ALLOWED)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scheme — HTTPS: mixed case (must be allowed, `new URL().protocol` lowercases)
// ---------------------------------------------------------------------------
describe("T2 — HTTPS: mixed case scheme", () => {
  it("accepts HTTPS: with any casing (URL API lowercases protocol)", () => {
    expect(isHostAllowed("HTTPS://cdn.lumencast.dev/a.png", ALLOWED)).toBe(true);
    expect(isHostAllowed("Https://cdn.lumencast.dev/a.png", ALLOWED)).toBe(true);
    expect(isHostAllowed("hTtPs://cdn.lumencast.dev/a.png", ALLOWED)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MAX_URL_LEN boundary (8 192 bytes)
// ---------------------------------------------------------------------------
describe("T2 — MAX_URL_LEN boundary", () => {
  const base = "https://cdn.lumencast.dev/";
  const pad = (n: number) => "x".repeat(n);

  it("accepts a URL exactly at the 8 192-character cap", () => {
    const url = base + pad(8192 - base.length);
    expect(url.length).toBe(8192);
    expect(isHostAllowed(url, ALLOWED)).toBe(true);
  });

  it("rejects a URL one character over the 8 192 cap", () => {
    const url = base + pad(8192 - base.length + 1);
    expect(url.length).toBe(8193);
    expect(isHostAllowed(url, ALLOWED)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trailing-dot hostname (`cdn.x.` ≠ `cdn.x`)
// ---------------------------------------------------------------------------
describe("T1 — trailing-dot hostname", () => {
  it("rejects https://cdn.lumencast.dev./a.png when allowlist has cdn.lumencast.dev (no trailing dot)", () => {
    // `new URL('https://cdn.lumencast.dev./a.png').hostname` → 'cdn.lumencast.dev.'
    // which does NOT equal 'cdn.lumencast.dev' → rejected.
    expect(isHostAllowed("https://cdn.lumencast.dev./a.png", ALLOWED)).toBe(false);
  });

  it("accepts when allowlist entry itself carries the trailing dot", () => {
    expect(isHostAllowed("https://cdn.lumencast.dev./a.png", ["cdn.lumencast.dev."])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Localhost / 0.0.0.0 / loopback IPs not in allowlist
// ---------------------------------------------------------------------------
describe("T1 — localhost and loopback addresses", () => {
  it("rejects https://localhost/a.png when not in allowlist", () => {
    expect(isHostAllowed("https://localhost/a.png", ALLOWED)).toBe(false);
  });

  it("allows https://localhost when explicitly listed", () => {
    expect(isHostAllowed("https://localhost/a.png", ["localhost"])).toBe(true);
  });

  it("rejects https://0.0.0.0/a.png when not in allowlist", () => {
    expect(isHostAllowed("https://0.0.0.0/a.png", ALLOWED)).toBe(false);
  });

  it("rejects https://127.0.0.1/a.png when not in allowlist", () => {
    expect(isHostAllowed("https://127.0.0.1/a.png", ALLOWED)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Substring tricks — none of these should pass on an 'example.com' allowlist
// ---------------------------------------------------------------------------
describe("T1 — substring hostname tricks", () => {
  const EXAMPLE = ["example.com"];

  it("rejects evil-example.com", () => {
    expect(isHostAllowed("https://evil-example.com/a.png", EXAMPLE)).toBe(false);
  });

  it("rejects notexample.com", () => {
    expect(isHostAllowed("https://notexample.com/a.png", EXAMPLE)).toBe(false);
  });

  it("rejects example.com.attacker.com (contains listed as subdomain)", () => {
    expect(isHostAllowed("https://example.com.attacker.com/a.png", EXAMPLE)).toBe(false);
  });

  it("rejects attacker-example.com", () => {
    expect(isHostAllowed("https://attacker-example.com/a.png", EXAMPLE)).toBe(false);
  });

  it("rejects sub.example.com (subdomain not wildcard-matched)", () => {
    expect(isHostAllowed("https://sub.example.com/a.png", EXAMPLE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// IDN / punycode / unicode homoglyph
// ---------------------------------------------------------------------------
describe("T1 — IDN, punycode, unicode homoglyph", () => {
  it("rejects a punycode hostname not in allowlist", () => {
    // xn--cdn-toa.dev is a hypothetical IDN for a visually similar hostname.
    expect(isHostAllowed("https://xn--cdn-toa.dev/a.png", ALLOWED)).toBe(false);
  });

  it("rejects a unicode homoglyph hostname (cyrillic 'с' looks like ASCII 'c')", () => {
    // Cyrillic 'с' (U+0441) vs ASCII 'c' — the parsed hostname is different.
    expect(isHostAllowed("https://сdn.lumencast.dev/a.png", ALLOWED)).toBe(false);
  });

  it("rejects an explicitly listed IDN unless the allowlist uses the same form", () => {
    // punycode and unicode are distinct hostnames in WHATWG URL parsing.
    expect(isHostAllowed("https://xn--cdn-toa.dev/a.png", ["cdné.dev"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Allowlist with non-string entries (defensive)
// ---------------------------------------------------------------------------
describe("T1 — allowlist with non-string entries (defensive)", () => {
  it("skips non-string entries and falls through to string matches", () => {
    // The implementation guards `typeof entry === 'string'`. A non-string entry
    // must never cause a throw or a false positive.
    expect(
      isHostAllowed("https://cdn.lumencast.dev/a.png", [42 as never, "cdn.lumencast.dev"]),
    ).toBe(true);
    expect(isHostAllowed("https://cdn.lumencast.dev/a.png", [42 as never, null as never])).toBe(
      false,
    );
  });

  it("does not throw on a fully non-string allowlist", () => {
    expect(() => isHostAllowed("https://cdn.lumencast.dev/a.png", [42 as never])).not.toThrow();
    expect(isHostAllowed("https://cdn.lumencast.dev/a.png", [42 as never])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// data: image/* boundary — allowed raster types vs rejected types
// ---------------------------------------------------------------------------
describe("T2 — data: image/* bounded raster allowlist", () => {
  it("accepts data:image/gif;base64,…", () => {
    expect(isHostAllowed("data:image/gif;base64,R0lGODlhAQ=", [])).toBe(true);
  });

  it("accepts data:image/bmp;base64,…", () => {
    expect(isHostAllowed("data:image/bmp;base64,Qk0=", [])).toBe(true);
  });

  it("accepts data:image/avif;base64,…", () => {
    expect(isHostAllowed("data:image/avif;base64,AAAAIG=", [])).toBe(true);
  });

  it("accepts data:image/x-icon;base64,…", () => {
    expect(isHostAllowed("data:image/x-icon;base64,AA==", [])).toBe(true);
  });

  it("accepts data:image/jpg;base64,… (alias)", () => {
    expect(isHostAllowed("data:image/jpg;base64,/9j/4A==", [])).toBe(true);
  });

  it("rejects data:image/tiff;base64,… (tiff not in the bounded set)", () => {
    expect(isHostAllowed("data:image/tiff;base64,AA==", [])).toBe(false);
  });

  it("rejects data:image/svg+xml;base64,… (SVG can carry script)", () => {
    expect(isHostAllowed("data:image/svg+xml;base64,PHN2Zz4=", [])).toBe(false);
  });

  it("rejects data:image/png without base64 encoding marker", () => {
    expect(isHostAllowed("data:image/png,rawdata", [])).toBe(false);
  });

  it("rejects data:image/ with an absent subtype", () => {
    expect(isHostAllowed("data:image/;base64,AA==", [])).toBe(false);
  });

  it("rejects a wildcard data:image/*", () => {
    expect(isHostAllowed("data:image/*;base64,AA==", [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkHostAllowed — R9 : static reasons, never the URL, on EVERY rejection path
// ---------------------------------------------------------------------------
describe("checkHostAllowed — R9 reason never echoes the URL (all paths)", () => {
  function assertR9(url: string, allowedHosts: readonly string[]): void {
    const d = checkHostAllowed(url, allowedHosts);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBeTypeOf("string");
    // The reason must never contain any fragment of the URL that could carry
    // sensitive on-air data (R9 contract).
    if (url.length > 0 && url.length < 100) {
      // Only for short urls where we can check substring presence meaningfully.
      // We split the url at the scheme boundary and check the host/path part.
      const urlBody = url.replace(/^[a-z+.-]*:/i, "").replace(/^\/\//, "");
      if (urlBody.length > 2) {
        // A non-trivial body — the reason must not echo it.
        expect(d.reason).not.toContain(urlBody.slice(0, 8));
      }
    }
  }

  it("non-string input — static reason, no echo", () => {
    const d = checkHostAllowed(42, ALLOWED);
    expect(d.reason).toBeTypeOf("string");
    expect(d.reason).not.toContain("42");
  });

  it("empty string — static reason", () => {
    const d = checkHostAllowed("", ALLOWED);
    expect(d.reason).toBeTypeOf("string");
    expect(d.reason!.length).toBeGreaterThan(0);
  });

  it("javascript: — reason does not echo the payload", () => {
    assertR9("javascript:alert(document.cookie)", ALLOWED);
  });

  it("data:text/html — reason does not echo the payload", () => {
    assertR9("data:text/html,<script>alert(1)</script>", ALLOWED);
  });

  it("file: — reason does not echo the path", () => {
    assertR9("file:///etc/shadow", ALLOWED);
  });

  it("unlisted host — reason does not echo the host", () => {
    const d = checkHostAllowed("https://secret-internal.corp.lan/token", ALLOWED);
    expect(d.allowed).toBe(false);
    expect(d.reason).not.toContain("secret-internal");
    expect(d.reason).not.toContain("corp.lan");
    expect(d.reason).not.toContain("token");
  });

  it("empty allowlist — static reason, no echo", () => {
    const d = checkHostAllowed("https://cdn.lumencast.dev/a.png", []);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBeTypeOf("string");
    expect(d.reason).not.toContain("cdn.lumencast.dev");
  });

  it("over-length URL — static reason, no echo of the URL body", () => {
    const url = "https://cdn.lumencast.dev/" + "a".repeat(9000);
    const d = checkHostAllowed(url, ALLOWED);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBeTypeOf("string");
    // The reason must not contain the padded body.
    expect(d.reason).not.toContain("aaaaaa");
  });

  it("allowed data:image — no reason field", () => {
    const d = checkHostAllowed("data:image/png;base64,iVBOR", []);
    expect(d.allowed).toBe(true);
    expect(d.reason).toBeUndefined();
  });

  it("allowed https — no reason field", () => {
    const d = checkHostAllowed("https://cdn.lumencast.dev/a.png", ALLOWED);
    expect(d.allowed).toBe(true);
    expect(d.reason).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Never throws (exhaustive adversarial inputs)
// ---------------------------------------------------------------------------
describe("isHostAllowed — never throws on adversarial inputs", () => {
  const adversarial: unknown[] = [
    null,
    undefined,
    0,
    NaN,
    Infinity,
    {},
    [],
    Symbol("x"),
    "\x00",
    "https://[::1]",
    "https://[",
    "://noscheme",
    "http\x00s://cdn.lumencast.dev/a.png",
    " javascript:alert(1)",
    "//cdn.lumencast.dev/a.png",
    "   ",
    "\t\n\r",
    "data:",
    "data:image/",
    "data:image/png",
  ];

  it("never throws on any adversarial input", () => {
    for (const input of adversarial) {
      expect(() => isHostAllowed(input, ALLOWED)).not.toThrow();
    }
  });

  it("never returns true for non-https, non-allowed-data adversarial inputs", () => {
    const hostile = [
      null,
      undefined,
      0,
      NaN,
      Infinity,
      {},
      [],
      "\x00",
      "://noscheme",
      "//cdn.lumencast.dev/a.png",
      "   ",
      "\t\n\r",
      "data:",
      "data:image/",
      "data:image/png",
    ] as unknown[];
    for (const input of hostile) {
      expect(isHostAllowed(input, ALLOWED)).toBe(false);
    }
  });
});
