import { defineConfig } from "vitest/config";

// Dedicated config for the conformance harness: loads byte-level fixtures
// from the lumencast-protocol repo and round-trips them.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/conformance/**/*.test.ts"],
  },
});
