import { describe, expect, it } from "vitest";
import {
  isArchive,
  LSMLZError,
  LSMLZ_FILE_EXTENSION,
  LSMLZ_MEDIA_TYPE,
  packArchive,
  unpackArchive,
} from "../src/index.js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const minimalCanonical = JSON.stringify({
  $schema: "https://lumencast.dev/schema/lsml/1.1/schema.json",
  lsml: "1.1",
  scene_id: "hello",
  scene_version: "sha256:" + "0".repeat(64),
  layout: { kind: "frame", size: { w: 100, h: 100 }, children: [] },
});

describe("packArchive / unpackArchive — round-trip", () => {
  it("packs a bundle with no assets and unpacks it byte-identically", () => {
    const bytes = packArchive({
      sceneId: "hello",
      canonical: minimalCanonical,
      assets: [],
    });
    const out = unpackArchive(bytes);
    expect(out.lsmlBytes).toBe(minimalCanonical);
    expect(out.assets).toEqual([]);
  });

  it("preserves asset paths and bytes byte-for-byte", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const bytes = packArchive({
      sceneId: "hello",
      canonical: minimalCanonical,
      assets: [
        { path: "assets/abc123.png", bytes: png },
        { path: "assets/def456.jpg", bytes: jpg },
      ],
    });
    const out = unpackArchive(bytes);
    expect(out.assets).toHaveLength(2);
    const abc = out.assets.find((a) => a.path === "assets/abc123.png");
    const def = out.assets.find((a) => a.path === "assets/def456.jpg");
    expect(abc?.bytes).toEqual(png);
    expect(def?.bytes).toEqual(jpg);
  });

  it("uses <scene_id>.lsml as the bundle entry name at the root", () => {
    const bytes = packArchive({
      sceneId: "my-scene",
      canonical: minimalCanonical,
      assets: [],
    });
    // Re-unzip directly to inspect entry names.
    const entries = unzipSync(bytes);
    expect(Object.keys(entries)).toContain("my-scene.lsml");
  });
});

describe("packArchive — debug subtree", () => {
  it("writes _debug/* entries when input.debug is provided", () => {
    const bytes = packArchive({
      sceneId: "hello",
      canonical: minimalCanonical,
      assets: [],
      debug: {
        "raw-source.json": '{"foo":42}',
        "trace.json": strToU8('["build-start"]'),
      },
    });
    const entries = unzipSync(bytes);
    expect(Object.keys(entries)).toContain("_debug/raw-source.json");
    expect(Object.keys(entries)).toContain("_debug/trace.json");
    expect(strFromU8(entries["_debug/raw-source.json"])).toBe('{"foo":42}');
  });

  it("ignores _debug/* on unpack — assets array stays clean", () => {
    const bytes = packArchive({
      sceneId: "hello",
      canonical: minimalCanonical,
      assets: [{ path: "assets/abc.png", bytes: new Uint8Array([1, 2, 3]) }],
      debug: { "trace.json": "[]" },
    });
    const out = unpackArchive(bytes);
    expect(out.assets).toHaveLength(1);
    expect(out.assets[0]?.path).toBe("assets/abc.png");
  });
});

describe("unpackArchive — error cases", () => {
  it("throws LSMLZ_BUNDLE_MISSING when no .lsml entry is present", () => {
    // Hand-craft an archive with only assets.
    const bytes = zipSync({ "assets/foo.png": new Uint8Array([1, 2, 3]) });
    expect(() => unpackArchive(bytes)).toThrowError(
      expect.objectContaining({ code: "LSMLZ_BUNDLE_MISSING" }),
    );
  });

  it("throws LSMLZ_NESTED_ARCHIVE on a nested .zip / .lsmlz", () => {
    const bytes = zipSync({
      "hello.lsml": strToU8(minimalCanonical),
      "nested.zip": new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    });
    expect(() => unpackArchive(bytes)).toThrowError(
      expect.objectContaining({ code: "LSMLZ_NESTED_ARCHIVE" }),
    );
  });

  it("throws LSMLZ_PATH_TRAVERSAL on a `..` segment", () => {
    const bytes = zipSync({
      "hello.lsml": strToU8(minimalCanonical),
      "../etc/evil": new Uint8Array([1]),
    });
    expect(() => unpackArchive(bytes)).toThrowError(
      expect.objectContaining({ code: "LSMLZ_PATH_TRAVERSAL" }),
    );
  });
});

describe("isArchive — magic-byte sniff", () => {
  it("returns true for a real LSMLZ archive", () => {
    const bytes = packArchive({
      sceneId: "hello",
      canonical: minimalCanonical,
      assets: [],
    });
    expect(isArchive(bytes)).toBe(true);
  });

  it("returns false for a bare LSML JSON", () => {
    const json = strToU8(minimalCanonical);
    expect(isArchive(json)).toBe(false);
  });

  it("returns false for too-short input", () => {
    expect(isArchive(new Uint8Array([0x50, 0x4b]))).toBe(false);
    expect(isArchive(new Uint8Array([]))).toBe(false);
  });
});

describe("constants", () => {
  it("exports the canonical media type and extension", () => {
    expect(LSMLZ_MEDIA_TYPE).toBe("application/lsml+zip");
    expect(LSMLZ_FILE_EXTENSION).toBe(".lsmlz");
  });
});

describe("LSMLZError", () => {
  it("is throwable and carries the code", () => {
    try {
      throw new LSMLZError("LSMLZ_BUNDLE_MISSING", "test");
    } catch (e) {
      expect(e).toBeInstanceOf(LSMLZError);
      expect((e as LSMLZError).code).toBe("LSMLZ_BUNDLE_MISSING");
    }
  });
});
