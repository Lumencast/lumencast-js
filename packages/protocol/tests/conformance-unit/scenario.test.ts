import { describe, expect, it } from "vitest";
import { parseScenario } from "../../src/conformance/index.js";

describe("parseScenario", () => {
  it("parses a minimal scenario", () => {
    const yaml = `
name: hello
description: "minimal"
tag: required
target: any
steps:
  - kind: client-sends
    frame:
      v: 1
      type: subscribe
      token: $TOKEN_OPERATOR
`;
    const sc = parseScenario(yaml);
    expect(sc.name).toBe("hello");
    expect(sc.tag).toBe("required");
    expect(sc.target).toBe("any");
    expect(sc.steps).toHaveLength(1);
    expect(sc.steps[0]?.kind).toBe("client-sends");
  });

  it("defaults tag=required + target=any when omitted", () => {
    const yaml = `
name: x
description: ""
steps: []
`;
    const sc = parseScenario(yaml);
    expect(sc.tag).toBe("required");
    expect(sc.target).toBe("any");
  });

  it("rejects scenarios without a name", () => {
    expect(() => parseScenario("description: x\nsteps: []\n")).toThrow(/name/);
  });

  it("rejects scenarios without steps[]", () => {
    expect(() => parseScenario("name: x\ndescription: y\n")).toThrow(/steps/);
  });

  it("preserves bundle declarations", () => {
    const yaml = `
name: with-bundle
description: ""
steps: []
bundles:
  - id: scoreboard
    inline:
      lsml: "1.0"
      scene_id: scoreboard
      layout: { kind: frame }
`;
    const sc = parseScenario(yaml);
    expect(sc.bundles).toHaveLength(1);
    expect(sc.bundles?.[0]?.id).toBe("scoreboard");
    expect((sc.bundles?.[0]?.inline as { lsml: string }).lsml).toBe("1.0");
  });
});
