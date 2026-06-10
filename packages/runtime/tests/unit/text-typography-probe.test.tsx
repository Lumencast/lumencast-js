// Probe — supplemental tests for text.tsx typography (ADR 001 §6 RC#4 + RC#11,
// issue #31, branch forge/31-full-typography).
//
// This file COMPLEMENTS Forge's text-typography.test.tsx without duplicating it.
// Every assertion here is executable and exposes a gap in the existing suite.
//
// Covered here :
//   A. Numeric boundary values : NaN, ±Infinity, -0, 0, negatives, 1e308,
//      numeric strings, null, objects, arrays — per field
//   B. lineHeight exact boundaries : 0 accepted, exact negative rejected
//   C. letterSpacing negatives : accepted (spec allows negative spacing)
//   D. maxLines positive-integer contract : 1 (min accepted), -1, 1e9
//      (large but integer — accepted, no DoS guard in spec), non-integers
//   E. Enum case-sensitivity : mixed-case and ALLCAPS rejected per closed set
//   F. Enum empty string : rejected
//   G. textTransform "URL(x)" injection variant
//   H. Interactions : maxLines + lineHeight:0 ; textDecoration+textTransform
// combined ; value="" with maxLines ; value of 100 k chars with maxLines
//   I. Delta live — all 4 new fields (lineHeight, fontStyle, textDecoration,
//      maxLines) not yet covered by Forge's live-delta tests
//   J. resolveTypography boundary : null/undefined/object/array inputs
//   K. warnRejectedTypo R9 : field name present, value never leaked, for every
//      new field not already checked by Forge

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import { resolveTypography } from "../../src/render/primitives/text.js";
import { createStore, type Store } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";

let container: HTMLDivElement;
let root: Root;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  warnSpy.mockRestore();
});

async function render(node: RenderNode, store: Store): Promise<void> {
  await act(async () => {
    root.render(<Tree node={node} store={store} />);
  });
}

async function renderText(props: Record<string, unknown>): Promise<HTMLSpanElement> {
  await render({ kind: "text", props: { value: "hello", ...props } }, createStore());
  return container.querySelector("span")!;
}

function styleOf(el: Element | null): string {
  return el?.getAttribute("style") ?? "";
}

// ─── A. Numeric boundary values per numeric field ─────────────────────

describe("A — numeric boundary values", () => {
  // lineHeight
  // Note: 1e308 is finite (< Number.MAX_VALUE ≈ 1.8e308) → accepted, see §B.
  // undefined → early-return, no warn → not in this list.
  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1e308,
    "1.5",
    null,
    {},
    [],
  ])("lineHeight = %j → rejected (not finite positive or wrong type)", async (v) => {
    const span = await renderText({ lineHeight: v });
    expect(span.style.lineHeight).toBe("");
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.join(" ")).toContain("text.lineHeight");
  });

  // letterSpacing
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "2", null, {}, []])(
    "letterSpacing = %j → rejected",
    async (v) => {
      const span = await renderText({ letterSpacing: v });
      expect(span.style.letterSpacing).toBe("");
      expect(warnSpy).toHaveBeenCalled();
      const calls = warnSpy.mock.calls.flat().map(String);
      expect(calls.join(" ")).toContain("text.letterSpacing");
    },
  );

  // maxLines
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "3", null, {}, []])(
    "maxLines = %j → rejected (not positive integer)",
    async (v) => {
      const span = await renderText({ maxLines: v });
      expect(styleOf(span)).not.toContain("ellipsis");
      expect(span.style.display).toBe("inline-block");
      expect(warnSpy).toHaveBeenCalled();
      const calls = warnSpy.mock.calls.flat().map(String);
      expect(calls.join(" ")).toContain("text.maxLines");
    },
  );
});

// ─── B. lineHeight exact boundaries ──────────────────────────────────

describe("B — lineHeight exact boundaries", () => {
  it("lineHeight = 0 is accepted (schema minimum 0)", async () => {
    const span = await renderText({ lineHeight: 0 });
    expect(span.style.lineHeight).toBe("0");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("lineHeight = -0 is accepted (−0 === 0, ≥ 0 check passes)", async () => {
    // IEEE -0 is === 0, so -0 >= 0 is true and is finite — accepted.
    const span = await renderText({ lineHeight: -0 });
    // -0 renders as "0" in CSS
    expect(span.style.lineHeight).toBe("0");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("lineHeight = 0.0001 (near-zero positive) is accepted", async () => {
    const frag = resolveTypography({ lineHeight: 0.0001 });
    expect(frag.lineHeight).toBe(0.0001);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("lineHeight = -0.001 (smallest negative) is rejected", async () => {
    const frag = resolveTypography({ lineHeight: -0.001 });
    expect(frag.lineHeight).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("lineHeight = Number.MAX_VALUE is accepted (finite positive)", async () => {
    const frag = resolveTypography({ lineHeight: Number.MAX_VALUE });
    expect(frag.lineHeight).toBe(Number.MAX_VALUE);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── C. letterSpacing — negatives accepted ────────────────────────────

describe("C — letterSpacing negatives accepted (spec: any finite number)", () => {
  it("letterSpacing = -1 renders as -1px", async () => {
    const span = await renderText({ letterSpacing: -1 });
    expect(span.style.letterSpacing).toBe("-1px");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("letterSpacing = -0.5 renders as -0.5px", async () => {
    const span = await renderText({ letterSpacing: -0.5 });
    expect(span.style.letterSpacing).toBe("-0.5px");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("letterSpacing = 0 renders as 0px", async () => {
    const span = await renderText({ letterSpacing: 0 });
    expect(span.style.letterSpacing).toBe("0px");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── D. maxLines positive-integer contract ────────────────────────────

describe("D — maxLines integer contract boundaries", () => {
  it("maxLines = 1 (minimum accepted integer) enables clamp", async () => {
    const frag = resolveTypography({ maxLines: 1 });
    expect(frag.WebkitLineClamp).toBe(1);
    expect(frag.overflow).toBe("hidden");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("maxLines = -1 is rejected (negative)", async () => {
    const frag = resolveTypography({ maxLines: -1 });
    expect(frag).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.join(" ")).toContain("text.maxLines");
  });

  it("maxLines = 1.5 is rejected (non-integer)", async () => {
    const frag = resolveTypography({ maxLines: 1.5 });
    expect(frag).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
  });

  it("maxLines = 1e9 is accepted (large integer, no DoS guard in spec)", async () => {
    // The spec does not define an upper bound; positiveInteger accepts any
    // integer ≥ 1. We assert acceptance and that WebkitLineClamp equals 1e9.
    const frag = resolveTypography({ maxLines: 1e9 });
    expect(frag.WebkitLineClamp).toBe(1e9);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("maxLines = 0 is rejected (must be ≥ 1)", async () => {
    const frag = resolveTypography({ maxLines: 0 });
    expect(frag).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
  });

  it("maxLines = Number.MAX_SAFE_INTEGER is accepted", async () => {
    const frag = resolveTypography({ maxLines: Number.MAX_SAFE_INTEGER });
    expect(frag.WebkitLineClamp).toBe(Number.MAX_SAFE_INTEGER);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── E. Enum case-sensitivity ─────────────────────────────────────────

describe("E — enum case-sensitivity (closed set, exact match only)", () => {
  it.each([
    ["textTransform", "UPPERCASE"],
    ["textTransform", "Uppercase"],
    ["textTransform", "UpperCase"],
    ["textDecoration", "Underline"],
    ["textDecoration", "UNDERLINE"],
    ["fontStyle", "Italic"],
    ["fontStyle", "ITALIC"],
    ["fontStyle", "Normal"],
  ])("%s = %j (wrong case) → rejected", (field, value) => {
    const frag = resolveTypography({ [field]: value });
    // None of the field keys should be set
    expect((frag as Record<string, unknown>)[field]).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.join(" ")).toContain(`text.${field}`);
    for (const arg of calls) {
      expect(arg).not.toContain(value);
    }
  });
});

// ─── F. Enum empty string → rejected ─────────────────────────────────

describe("F — empty string enum values → rejected", () => {
  it.each(["textTransform", "textDecoration", "fontStyle"])(
    '%s = "" → rejected (not in closed set)',
    (field) => {
      const frag = resolveTypography({ [field]: "" });
      expect((frag as Record<string, unknown>)[field]).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    },
  );
});

// ─── G. textTransform injection variants ─────────────────────────────

describe("G — textTransform injection variants", () => {
  it('textTransform = "URL(x)" is rejected, never reaches style', async () => {
    const span = await renderText({ textTransform: "URL(x)" });
    expect(span.style.textTransform).toBe("");
    expect(styleOf(span)).not.toContain("URL(");
    expect(styleOf(span)).not.toContain("url(");
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.join(" ")).toContain("text.textTransform");
    for (const arg of calls) {
      expect(arg).not.toContain("URL(x)");
    }
  });

  it('textTransform = "none\\x00" (null-byte) is rejected', () => {
    const frag = resolveTypography({ textTransform: "none\x00" });
    expect(frag.textTransform).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ─── H. Interactions ─────────────────────────────────────────────────

describe("H — field interactions", () => {
  it("maxLines + lineHeight:0 coexist (both properties rendered)", async () => {
    const frag = resolveTypography({ maxLines: 2, lineHeight: 0 });
    expect(frag.lineHeight).toBe(0);
    expect(frag.WebkitLineClamp).toBe(2);
    expect(frag.overflow).toBe("hidden");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("textDecoration + textTransform combined render independently", async () => {
    const span = await renderText({
      textDecoration: "underline",
      textTransform: "uppercase",
    });
    expect(span.style.textDecoration).toBe("underline");
    expect(span.style.textTransform).toBe("uppercase");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("all 5 typo fields + maxLines together produce the expected fragment", () => {
    const frag = resolveTypography({
      lineHeight: 1.5,
      letterSpacing: -0.5,
      textTransform: "lowercase",
      textDecoration: "line-through",
      fontStyle: "oblique",
      maxLines: 3,
    });
    expect(frag.lineHeight).toBe(1.5);
    expect(frag.letterSpacing).toBe("-0.5px");
    expect(frag.textTransform).toBe("lowercase");
    expect(frag.textDecoration).toBe("line-through");
    expect(frag.fontStyle).toBe("oblique");
    expect(frag.WebkitLineClamp).toBe(3);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("value=undefined renders as empty string (line 27 branch)", async () => {
    // resolved.value === undefined → String coercion skipped → textContent ""
    await render({ kind: "text", props: {} }, createStore());
    const span = container.querySelector("span")!;
    expect(span.textContent).toBe("");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("value='' (empty text) with maxLines renders clamp without crashing", async () => {
    await render({ kind: "text", props: { value: "", maxLines: 1 } }, createStore());
    const span = container.querySelector("span")!;
    expect(span.textContent).toBe("");
    expect(span.style.textOverflow).toBe("ellipsis");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("value of 100k chars with maxLines does not throw (perf smoke)", async () => {
    const longText = "a".repeat(100_000);
    await render({ kind: "text", props: { value: longText, maxLines: 2 } }, createStore());
    const span = container.querySelector("span")!;
    expect(span.textContent?.length).toBe(100_000);
    expect(span.style.textOverflow).toBe("ellipsis");
  });
});

// ─── I. Delta live — all 4 new fields not covered by Forge ───────────

describe("I — delta live on all new typography fields (RC#4)", () => {
  it("lineHeight live delta : valid → applied, hostile → fallback, valid → recovery", async () => {
    const store = createStore();
    store.set("t.lh", 1.4);
    const node: RenderNode = {
      kind: "text",
      props: { value: "hi" },
      bindings: { lineHeight: "t.lh" },
    };
    await render(node, store);
    const span = container.querySelector("span")!;
    expect(span.style.lineHeight).toBe("1.4");

    await act(async () => {
      store.set("t.lh", -5); // hostile — negative
    });
    expect(span.style.lineHeight).toBe("");
    expect(warnSpy).toHaveBeenCalled();

    await act(async () => {
      store.set("t.lh", 1.8);
    });
    expect(span.style.lineHeight).toBe("1.8");
  });

  it("fontStyle live delta : valid → applied, hostile → fallback, valid → recovery", async () => {
    const store = createStore();
    store.set("t.fs", "italic");
    const node: RenderNode = {
      kind: "text",
      props: { value: "hi" },
      bindings: { fontStyle: "t.fs" },
    };
    await render(node, store);
    const span = container.querySelector("span")!;
    expect(span.style.fontStyle).toBe("italic");

    await act(async () => {
      store.set("t.fs", "ITALIC"); // wrong case — hostile
    });
    expect(span.style.fontStyle).toBe("");

    await act(async () => {
      store.set("t.fs", "oblique");
    });
    expect(span.style.fontStyle).toBe("oblique");
  });

  it("textDecoration live delta : valid → applied, hostile → fallback, valid → recovery", async () => {
    const store = createStore();
    store.set("t.td", "underline");
    const node: RenderNode = {
      kind: "text",
      props: { value: "hi" },
      bindings: { textDecoration: "t.td" },
    };
    await render(node, store);
    const span = container.querySelector("span")!;
    expect(span.style.textDecoration).toBe("underline");

    await act(async () => {
      store.set("t.td", "overline"); // not in enum
    });
    expect(span.style.textDecoration).toBe("");

    await act(async () => {
      store.set("t.td", "line-through");
    });
    expect(span.style.textDecoration).toBe("line-through");
  });

  it("maxLines live delta : hostile string resets clamp with R9 diagnostic", async () => {
    const store = createStore();
    store.set("t.ml", 2);
    const node: RenderNode = {
      kind: "text",
      props: { value: "hi" },
      bindings: { maxLines: "t.ml" },
    };
    await render(node, store);
    const span = container.querySelector("span")!;
    expect(span.style.overflow).toBe("hidden");

    await act(async () => {
      store.set("t.ml", 1.5); // non-integer
    });
    expect(styleOf(span)).not.toContain("ellipsis");
    expect(span.style.display).toBe("inline-block");
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.join(" ")).toContain("text.maxLines");
    for (const arg of calls) {
      expect(arg).not.toContain("1.5");
    }

    await act(async () => {
      store.set("t.ml", 4); // valid recovery
    });
    expect(span.style.overflow).toBe("hidden");
    expect(span.style.textOverflow).toBe("ellipsis");
  });

  it("letterSpacing live delta : negative value applied (valid), Infinity rejected", async () => {
    const store = createStore();
    store.set("t.ls", -0.5);
    const node: RenderNode = {
      kind: "text",
      props: { value: "hi" },
      bindings: { letterSpacing: "t.ls" },
    };
    await render(node, store);
    const span = container.querySelector("span")!;
    expect(span.style.letterSpacing).toBe("-0.5px");

    await act(async () => {
      store.set("t.ls", Infinity);
    });
    expect(span.style.letterSpacing).toBe("");

    await act(async () => {
      store.set("t.ls", 2);
    });
    expect(span.style.letterSpacing).toBe("2px");
  });
});

// ─── J. resolveTypography boundary — null/object/array inputs ─────────

describe("J — resolveTypography boundary: non-conforming type inputs", () => {
  it.each([
    ["lineHeight", null],
    ["lineHeight", {}],
    ["lineHeight", [1.4]],
    ["letterSpacing", null],
    ["letterSpacing", {}],
    ["letterSpacing", [2]],
    ["textTransform", null],
    ["textTransform", 42],
    ["textDecoration", null],
    ["textDecoration", true],
    ["fontStyle", null],
    ["fontStyle", false],
    ["maxLines", null],
    ["maxLines", {}],
    ["maxLines", [2]],
  ])("resolveTypography({ %s: %j }) → field omitted, R9 issued", (field, value) => {
    const frag = resolveTypography({ [field]: value });
    // Field must be absent from the result
    expect((frag as Record<string, unknown>)[field]).toBeUndefined();
    // maxLines rejection cascades to 5 clamp props
    if (field === "maxLines") {
      expect(frag.WebkitLineClamp).toBeUndefined();
      expect(frag.overflow).toBeUndefined();
    }
    expect(warnSpy).toHaveBeenCalled();
  });

  it("resolveTypography({}) returns empty object without warnings", () => {
    const frag = resolveTypography({});
    expect(frag).toEqual({});
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("undefined values for all fields → no warnings, empty fragment", () => {
    const frag = resolveTypography({
      lineHeight: undefined,
      letterSpacing: undefined,
      textTransform: undefined,
      textDecoration: undefined,
      fontStyle: undefined,
      maxLines: undefined,
    });
    expect(frag).toEqual({});
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── K. R9 diagnostic contract per new field ─────────────────────────

describe("K — R9 diagnostic: field name present, rejected value never leaked", () => {
  const SECRET_VALUE = "secret-injection-token; } body { color: red";

  it.each(["lineHeight", "letterSpacing", "textTransform", "textDecoration", "fontStyle"])(
    "%s: hostile string → field name in warn, value withheld",
    (field) => {
      resolveTypography({ [field]: SECRET_VALUE });
      expect(warnSpy).toHaveBeenCalled();
      const calls = warnSpy.mock.calls.flat().map(String);
      const joined = calls.join(" ");
      expect(joined).toContain(`text.${field}`);
      expect(joined).not.toContain("secret-injection-token");
      expect(joined).not.toContain(SECRET_VALUE);
    },
  );

  it("maxLines hostile string → field name in warn, value withheld", () => {
    resolveTypography({ maxLines: SECRET_VALUE });
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.join(" ")).toContain("text.maxLines");
    for (const arg of calls) {
      expect(arg).not.toContain("secret-injection-token");
    }
  });
});
