/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for tryObscura — Chrome DevTools Protocol client via WebSocket.
 * Mocks globalThis.WebSocket with a controllable fake.
 */

interface FakeWebSocket {
  onopen: ((...args: unknown[]) => void) | null;
  onerror: ((...args: unknown[]) => void) | null;
  onmessage: ((...args: unknown[]) => void) | null;
  onclose: ((...args: unknown[]) => void) | null;
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface WsController {
  ws: FakeWebSocket;
  open: () => void;
  message: (data: string) => void;
  error: () => void;
  close: () => void;
}

function makeController(): WsController {
  const ctrl: Partial<WsController> = {};
  const ws: FakeWebSocket = {
    onopen: null,
    onerror: null,
    onmessage: null,
    onclose: null,
    readyState: 0,
    send: vi.fn(),
    close: vi.fn(),
  };
  ctrl.ws = ws;
  ctrl.open = () => {
    ws.readyState = 1;
    ws.onopen?.();
  };
  ctrl.message = (data: string) => {
    ws.onmessage?.({ data });
  };
  ctrl.error = () => {
    ws.onerror?.(new Event("error"));
  };
  ctrl.close = () => {
    ws.readyState = 3;
    ws.onclose?.(new Event("close"));
  };
  return ctrl as WsController;
}

describe("tryObscura", () => {
  let originalWebSocket: typeof globalThis.WebSocket;
  let ctrl: WsController;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  it("should return null when WebSocket connection fails (onerror)", async () => {
    ctrl = makeController();
    vi.stubGlobal(
      "WebSocket",
      vi.fn(function () {
        return ctrl.ws;
      }),
    );

    const { tryObscura } = await import("../../extensions/link-summarizer/cdp.js");
    const promise = tryObscura("https://example.com");

    // Let WebSocket constructor run, then trigger error
    await vi
      .waitFor(
        () => {
          expect(ctrl.ws.send).toHaveBeenCalled();
        },
        { timeout: 1000 },
      )
      .catch(() => {});

    // If ws.send was never called, the connection hasn't opened yet, trigger error
    ctrl.error();

    const result = await promise;
    expect(result).toBeNull();
  });

  it("should return null when aborted before connection", async () => {
    ctrl = makeController();
    vi.stubGlobal(
      "WebSocket",
      vi.fn(function () {
        return ctrl.ws;
      }),
    );

    const { tryObscura } = await import("../../extensions/link-summarizer/cdp.js");
    const controller = new AbortController();
    controller.abort();

    const result = await tryObscura("https://example.com", controller.signal);
    expect(result).toBeNull();
  });

  it("should return null when Target.createTarget returns no targetId", async () => {
    ctrl = makeController();
    vi.stubGlobal(
      "WebSocket",
      vi.fn(function () {
        return ctrl.ws;
      }),
    );

    const { tryObscura } = await import("../../extensions/link-summarizer/cdp.js");
    const promise = tryObscura("https://example.com");

    await vi.waitFor(
      () => {
        expect(vi.mocked(globalThis.WebSocket)).toHaveBeenCalled();
      },
      { timeout: 1000 },
    );

    ctrl.open();

    await vi.waitFor(
      () => {
        expect(ctrl.ws.send).toHaveBeenCalled();
      },
      { timeout: 1000 },
    );

    const createCall = ctrl.ws.send.mock.calls.find((args: string[]) => {
      const parsed = JSON.parse(args[0]);
      return parsed.method === "Target.createTarget";
    });
    ctrl.message(JSON.stringify({ id: JSON.parse(createCall![0]).id, result: {} }));

    const result = await promise;
    expect(result).toBeNull();
  });
});
