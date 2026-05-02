// Test bundle used by the E2E suite. Speaks the runtime's flat compiled form.

import type { RenderBundle } from "../../../src/render/bundle";

export const SCENE_ID = "e2e-scoreboard";
export const SCENE_VERSION = "sha256:e2e-scoreboard-v1";

export const BUNDLE: RenderBundle = {
  scene_version: SCENE_VERSION,
  root: {
    kind: "stack",
    id: "root",
    props: { direction: "vertical", gap: 16, align: "center", justify: "center" },
    children: [
      {
        kind: "text",
        id: "title",
        props: { size: 48, weight: 700, colour: "#ffffff" },
        bindings: { value: "show.title" },
      },
      {
        kind: "stack",
        id: "scores",
        props: { direction: "horizontal", gap: 32 },
        children: [
          {
            kind: "text",
            id: "home",
            props: { size: 64, weight: 800, colour: "#22d3ee" },
            bindings: { value: "score.home" },
          },
          {
            kind: "text",
            id: "away",
            props: { size: 64, weight: 800, colour: "#f97316" },
            bindings: { value: "score.away" },
          },
        ],
      },
    ],
  },
  operator_inputs: [
    {
      path: "__inputs.show_title",
      label: "Show title",
      type: "text",
      writable_by: ["operator"],
    },
  ],
};

export const INITIAL_STATE: Record<string, unknown> = {
  "show.title": "Acceptance Cup",
  "score.home": 0,
  "score.away": 0,
};
