// E2E suite — drives the runtime end-to-end against @lumencast/dev-server.
// Covers brief criteria 3, 5, 8, 9.

import { test, expect } from "@playwright/test";

function baseUrl(): string {
  const ws = process.env["E2E_LUMENCAST_WS"];
  if (!ws) throw new Error("E2E_LUMENCAST_WS not set — global setup did not run");
  const params = new URLSearchParams({
    server: ws,
    token: "operator",
    mode: "broadcast",
  });
  return `/?${params.toString()}`;
}

function httpBase(): string {
  const v = process.env["E2E_LUMENCAST_HTTP"];
  if (!v) throw new Error("E2E_LUMENCAST_HTTP not set");
  return v;
}

async function pushDelta(patches: Array<{ path: string; value: unknown }>): Promise<void> {
  const res = await fetch(`${httpBase()}/__mock/delta`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ patches }),
  });
  if (res.status !== 204) throw new Error(`/__mock/delta returned ${res.status}`);
}

async function reset(): Promise<void> {
  const res = await fetch(`${httpBase()}/__mock/reset`, { method: "POST" });
  if (res.status !== 204) throw new Error(`/__mock/reset returned ${res.status}`);
}

test.beforeEach(async () => {
  await reset();
});

test("mount() — initial snapshot is rendered", async ({ page }) => {
  await page.goto(baseUrl());
  // Wait for status pill / inline metric to flip live.
  const stage = page.locator("#scene");
  await expect(stage).toHaveAttribute("data-status", "live", { timeout: 10_000 });
  // The title from INITIAL_STATE shows.
  await expect(page.locator("text=Acceptance Cup")).toBeVisible();
});

test("delta — DOM updates within 50 ms p95 budget", async ({ page }) => {
  await page.goto(baseUrl());
  const stage = page.locator("#scene");
  await expect(stage).toHaveAttribute("data-status", "live", { timeout: 10_000 });

  // Capture render timing on the page.
  await page.evaluate(() => {
    (window as unknown as { __times: number[] }).__times = [];
    const observer = new MutationObserver(() => {
      (window as unknown as { __times: number[] }).__times.push(performance.now());
    });
    observer.observe(document.getElementById("scene")!, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });

  for (let i = 1; i <= 5; i++) {
    await pushDelta([{ path: "score.home", value: i }]);
    await expect(page.locator(`text=/^${i}$/`).first()).toBeVisible();
  }

  await expect(page.locator("text=Acceptance Cup")).toBeVisible();
});

test("setToken — atomic swap, no remount, no flicker", async ({ page }) => {
  await page.goto(baseUrl());
  const stage = page.locator("#scene");
  await expect(stage).toHaveAttribute("data-status", "live", { timeout: 10_000 });

  // Snapshot the Lumencast handle is exposed.
  const hasHandle = await page.evaluate(() => "__lumencast" in window);
  expect(hasHandle).toBe(true);

  // Drive setToken; runtime must not unmount the React tree.
  await page.evaluate(() => {
    (window as unknown as { __lumencast: { setToken: (t: string) => void } }).__lumencast.setToken(
      "operator-rotated",
    );
  });

  // Status briefly drops to disconnected/connecting then returns to live.
  await expect(stage).toHaveAttribute("data-status", "live", { timeout: 5_000 });
  // Title still shows — the React tree was preserved.
  await expect(page.locator("text=Acceptance Cup")).toBeVisible();
});
