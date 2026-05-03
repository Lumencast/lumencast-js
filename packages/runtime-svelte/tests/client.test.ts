import { describe, expect, it } from "vitest";
import { createClient, type Status, type LeafState } from "../src/_internal/client.js";

// Minimal WebSocket mock — only the surface the client uses.
class MockWebSocket {
  static OPEN = 1;
  readonly OPEN = 1;
  readyState = 0;
  url: string;
  protocols: string[];
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
  }

  addEventListener(name: string, fn: (ev: unknown) => void): void {
    (this.listeners[name] ??= []).push(fn);
  }
  removeEventListener(name: string, fn: (ev: unknown) => void): void {
    const arr = this.listeners[name];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  send(data: string): void {
    this.lastSent.push(data);
  }
  close(_code?: number, _reason?: string): void {
    this.readyState = 3;
    this.fire("close", {});
  }

  // Test-only helpers
  lastSent: string[] = [];
  triggerOpen(): void {
    this.readyState = 1;
    this.fire("open", {});
  }
  triggerMessage(data: string): void {
    this.fire("message", { data });
  }
  triggerClose(): void {
    this.readyState = 3;
    this.fire("close", {});
  }
  private fire(name: string, ev: unknown): void {
    for (const fn of this.listeners[name] ?? []) fn(ev);
  }
}

describe("createClient", () => {
  it("subscribes on open and absorbs the snapshot", async () => {
    const sockets: MockWebSocket[] = [];
    const states: LeafState[] = [];
    const statuses: Status[] = [];

    const client = createClient(
      {
        url: "ws://test/lsdp.v1",
        token: "tok",
        webSocketImpl: function (this: unknown, url: string, protocols?: string | string[]) {
          const s = new MockWebSocket(url, protocols);
          sockets.push(s);
          return s;
        } as unknown as typeof WebSocket,
      },
      {
        onStatus: (s) => statuses.push(s),
        onState: (s) => states.push(s),
      },
    );

    // Wait a few microticks for the async open() chain in the client.
    await new Promise((r) => setTimeout(r, 0));
    expect(sockets.length).toBe(1);
    const ws = sockets[0]!;

    ws.triggerOpen();
    expect(ws.lastSent.length).toBe(1);
    const sent = JSON.parse(ws.lastSent[0]!);
    expect(sent.type).toBe("subscribe");
    expect(sent.token).toBe("tok");

    ws.triggerMessage(
      JSON.stringify({
        v: 1,
        type: "snapshot",
        seq: 1,
        scene_id: "t",
        scene_version: "sha256:" + "a".repeat(64),
        state: { count: 0, title: "Hello" },
      }),
    );

    expect(states[states.length - 1]).toEqual({ count: 0, title: "Hello" });
    expect(statuses).toContain("connecting");
    expect(statuses).toContain("live");

    client.dispose();
  });

  it("applies deltas in order and reconnects on a sequence gap", async () => {
    const sockets: MockWebSocket[] = [];
    const states: LeafState[] = [];

    const client = createClient(
      {
        url: "ws://test/lsdp.v1",
        token: "tok",
        reconnectInitialMs: 1,
        reconnectMaxMs: 1,
        webSocketImpl: function (this: unknown, url: string) {
          const s = new MockWebSocket(url);
          sockets.push(s);
          return s;
        } as unknown as typeof WebSocket,
      },
      {
        onStatus: () => undefined,
        onState: (s) => states.push(s),
      },
    );

    await new Promise((r) => setTimeout(r, 0));
    const ws = sockets[0]!;
    ws.triggerOpen();
    ws.triggerMessage(
      JSON.stringify({
        v: 1,
        type: "snapshot",
        seq: 1,
        scene_id: "t",
        scene_version: "sha256:" + "a".repeat(64),
        state: { count: 0 },
      }),
    );
    ws.triggerMessage(
      JSON.stringify({
        v: 1,
        type: "delta",
        seq: 2,
        patches: [{ path: "count", value: 1 }],
      }),
    );
    expect(states[states.length - 1]).toEqual({ count: 1 });

    // Inject a gap: skip seq=3 and send seq=4.
    ws.triggerMessage(
      JSON.stringify({
        v: 1,
        type: "delta",
        seq: 4,
        patches: [{ path: "count", value: 99 }],
      }),
    );
    // Gap → close(); the client reschedules open().
    expect(ws.readyState).toBe(3);

    client.dispose();
  });

  it("dispose() stops further callbacks", async () => {
    const sockets: MockWebSocket[] = [];
    const states: LeafState[] = [];

    const client = createClient(
      {
        url: "ws://test/lsdp.v1",
        token: "tok",
        webSocketImpl: function (this: unknown, url: string) {
          const s = new MockWebSocket(url);
          sockets.push(s);
          return s;
        } as unknown as typeof WebSocket,
      },
      {
        onStatus: () => undefined,
        onState: (s) => states.push(s),
      },
    );

    await new Promise((r) => setTimeout(r, 0));
    const ws = sockets[0]!;
    ws.triggerOpen();
    client.dispose();
    ws.triggerMessage(
      JSON.stringify({
        v: 1,
        type: "snapshot",
        seq: 1,
        scene_id: "t",
        scene_version: "sha256:" + "a".repeat(64),
        state: { x: 1 },
      }),
    );
    expect(states.find((s) => s.x === 1)).toBeUndefined();
  });
});
