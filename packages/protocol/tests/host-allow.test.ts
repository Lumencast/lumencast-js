import { describe, expect, it } from "vitest";
import { isHostAllowed, checkHostAllowed } from "../src/index.js";

// Bastion conditions T1 (host allowlist, strict hostname match) + T2 (scheme
// allowlist). Exhaustive : trompe-l'œil hosts, subdomains, IPs, ports, hostile
// schemes, malformed URLs (ADR 002 #C).

const ALLOWED = ["cdn.lumencast.dev", "assets.example.com"];

describe("isHostAllowed — T1 host allowlist (exact hostname match)", () => {
  it("allows an exact host on https", () => {
    expect(isHostAllowed("https://cdn.lumencast.dev/a.png", ALLOWED)).toBe(true);
    expect(isHostAllowed("https://assets.example.com/x/y.jpg?v=2", ALLOWED)).toBe(true);
  });

  it("is case-insensitive on the hostname", () => {
    expect(isHostAllowed("https://CDN.Lumencast.DEV/a.png", ALLOWED)).toBe(true);
    expect(isHostAllowed("https://cdn.lumencast.dev/a.png", ["CDN.LUMENCAST.DEV"])).toBe(true);
  });

  it("rejects a trailing-domain trick (substring would have allowed)", () => {
    // `cdn.lumencast.dev.evil.com` — substring match on the raw string would
    // pass ; exact hostname match must reject.
    expect(isHostAllowed("https://cdn.lumencast.dev.evil.com/a.png", ALLOWED)).toBe(false);
  });

  it("rejects a leading-domain trick", () => {
    expect(isHostAllowed("https://evil.com/cdn.lumencast.dev/a.png", ALLOWED)).toBe(false);
    expect(isHostAllowed("https://evilcdn.lumencast.dev/a.png", ["cdn.lumencast.dev"])).toBe(false);
  });

  it("rejects a userinfo @-trick (hostname is evil.com)", () => {
    expect(isHostAllowed("https://cdn.lumencast.dev@evil.com/a.png", ALLOWED)).toBe(false);
    // even when the userinfo host IS allowed, embedded credentials are refused
    expect(isHostAllowed("https://user:pass@cdn.lumencast.dev/a.png", ALLOWED)).toBe(false);
  });

  it("rejects a sub-domain not explicitly allowed (no wildcard)", () => {
    expect(isHostAllowed("https://sub.cdn.lumencast.dev/a.png", ALLOWED)).toBe(false);
    expect(isHostAllowed("https://lumencast.dev/a.png", ALLOWED)).toBe(false);
  });

  it("rejects a port-bearing host (hostname excludes the port, but not on allowlist either way)", () => {
    expect(isHostAllowed("https://cdn.lumencast.dev:8443/a.png", ALLOWED)).toBe(true); // hostname matches; port irrelevant
    expect(isHostAllowed("https://evil.com:443/a.png", ALLOWED)).toBe(false);
  });

  it("rejects raw IPs unless explicitly allowed", () => {
    expect(isHostAllowed("https://93.184.216.34/a.png", ALLOWED)).toBe(false);
    expect(isHostAllowed("https://[2606:2800:220:1:248:1893:25c8:1946]/a.png", ALLOWED)).toBe(
      false,
    );
    expect(isHostAllowed("https://127.0.0.1/a.png", ["127.0.0.1"])).toBe(true);
  });

  it("denies every remote host when the allowlist is empty or absent", () => {
    expect(isHostAllowed("https://cdn.lumencast.dev/a.png", [])).toBe(false);
    expect(isHostAllowed("https://cdn.lumencast.dev/a.png", undefined)).toBe(false);
  });
});

describe("isHostAllowed — T2 scheme allowlist", () => {
  it("rejects javascript: URLs", () => {
    expect(isHostAllowed("javascript:alert(1)", ALLOWED)).toBe(false);
    expect(isHostAllowed("JavaScript:alert(1)", ALLOWED)).toBe(false);
  });

  it("rejects data:text and data:html payloads", () => {
    expect(isHostAllowed("data:text/html,<script>alert(1)</script>", ALLOWED)).toBe(false);
    expect(isHostAllowed("data:text/plain;base64,QQ==", ALLOWED)).toBe(false);
  });

  it("rejects data:image/svg+xml (can carry script)", () => {
    expect(isHostAllowed("data:image/svg+xml;base64,PHN2Zz4=", ALLOWED)).toBe(false);
  });

  it("rejects file:, blob:, vbscript: and http:", () => {
    expect(isHostAllowed("file:///etc/passwd", ALLOWED)).toBe(false);
    expect(isHostAllowed("blob:https://cdn.lumencast.dev/uuid", ALLOWED)).toBe(false);
    expect(isHostAllowed("vbscript:msgbox(1)", ALLOWED)).toBe(false);
    expect(isHostAllowed("http://cdn.lumencast.dev/a.png", ALLOWED)).toBe(false);
  });

  it("allows a bounded data:image/* base64 payload without a host", () => {
    expect(isHostAllowed("data:image/png;base64,iVBORw0KGgo=", [])).toBe(true);
    expect(isHostAllowed("data:image/jpeg;base64,/9j/4AAQ=", undefined)).toBe(true);
    expect(isHostAllowed("data:image/webp;base64,UklGR=", [])).toBe(true);
  });

  it("rejects a data:image without base64 or with a bad subtype", () => {
    expect(isHostAllowed("data:image/png,notbase64", ALLOWED)).toBe(false);
    expect(isHostAllowed("data:image/tiff;base64,AA==", ALLOWED)).toBe(false);
  });
});

describe("isHostAllowed — malformed / non-string input", () => {
  it("rejects non-string input", () => {
    expect(isHostAllowed(undefined, ALLOWED)).toBe(false);
    expect(isHostAllowed(null, ALLOWED)).toBe(false);
    expect(isHostAllowed(42, ALLOWED)).toBe(false);
    expect(isHostAllowed({ toString: () => "https://cdn.lumencast.dev/a.png" }, ALLOWED)).toBe(
      false,
    );
  });

  it("rejects empty, relative and protocol-relative URLs", () => {
    expect(isHostAllowed("", ALLOWED)).toBe(false);
    expect(isHostAllowed("/a.png", ALLOWED)).toBe(false);
    expect(isHostAllowed("a.png", ALLOWED)).toBe(false);
    expect(isHostAllowed("//cdn.lumencast.dev/a.png", ALLOWED)).toBe(false);
  });

  it("rejects garbage and over-length URLs", () => {
    expect(isHostAllowed("https://", ALLOWED)).toBe(false);
    expect(isHostAllowed("not a url at all", ALLOWED)).toBe(false);
    expect(isHostAllowed("https://cdn.lumencast.dev/" + "a".repeat(9000), ALLOWED)).toBe(false);
  });

  it("does not throw on any input", () => {
    const inputs: unknown[] = ["", "::::", "https://[", undefined, null, 0, {}, [], NaN];
    for (const i of inputs) expect(() => isHostAllowed(i, ALLOWED)).not.toThrow();
  });
});

describe("checkHostAllowed — static reasons, never the URL", () => {
  it("returns a static reason that does not echo the url", () => {
    const url = "https://secret-token.evil.com/leak";
    const d = checkHostAllowed(url, ALLOWED);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBeTypeOf("string");
    expect(d.reason).not.toContain("evil.com");
    expect(d.reason).not.toContain("secret-token");
  });

  it("returns no reason when allowed", () => {
    const d = checkHostAllowed("https://cdn.lumencast.dev/a.png", ALLOWED);
    expect(d.allowed).toBe(true);
    expect(d.reason).toBeUndefined();
  });
});
