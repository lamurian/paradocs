/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
describe("tryObscura complex flows", () => {
  let originalWebSocket: typeof globalThis.WebSocket;
  let ctrl: WsController;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
  });
  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  it("should handle a successful CDP flow with LP.getMarkdown", async () => {
    ctrl = makeController();
    vi.stubGlobal(
      "WebSocket",
      vi.fn(function () {
        return ctrl.ws;
      }),
    );
    const { tryObscura } = await import("../../extensions/link-summarizer/cdp.js");
    const promise = tryObscura("https://example.com/article");

    await vi.waitFor(() => expect(vi.mocked(globalThis.WebSocket)).toHaveBeenCalled(), {
      timeout: 1000,
    });
    ctrl.open();
    await vi.waitFor(() => expect(ctrl.ws.send).toHaveBeenCalled(), { timeout: 1000 });

    const createCall = ctrl.ws.send.mock.calls.find((args: string[]) => {
      const parsed = JSON.parse(args[0]) as { method: string };
      return parsed.method === "Target.createTarget";
    });
    ctrl.message(
      JSON.stringify({
        id: JSON.parse(createCall![0] as string).id,
        result: { targetId: "target-1" },
      }),
    );

    await vi.waitFor(
      () => {
        const c = ctrl.ws.send.mock.calls.filter((args: string[]) => {
          const parsed = JSON.parse(args[0]) as { method: string };
          return parsed.method === "Target.attachToTarget";
        });
        expect(c.length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
    const attachCall = ctrl.ws.send.mock.calls.find((args: string[]) => {
      const parsed = JSON.parse(args[0]) as { method: string };
      return parsed.method === "Target.attachToTarget";
    });
    ctrl.message(
      JSON.stringify({
        id: JSON.parse(attachCall![0] as string).id,
        result: { sessionId: "session-1" },
      }),
    );

    await vi.waitFor(
      () => {
        const c = ctrl.ws.send.mock.calls.filter((args: string[]) => {
          const parsed = JSON.parse(args[0]) as { method: string };
          return parsed.method === "Page.enable";
        });
        expect(c.length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
    const enableCall = ctrl.ws.send.mock.calls.find((args: string[]) => {
      const parsed = JSON.parse(args[0]) as { method: string };
      return parsed.method === "Page.enable";
    });
    ctrl.message(JSON.stringify({ id: JSON.parse(enableCall![0] as string).id, result: {} }));

    await vi.waitFor(
      () => {
        const c = ctrl.ws.send.mock.calls.filter((args: string[]) => {
          const parsed = JSON.parse(args[0]) as { method: string };
          return parsed.method === "Page.navigate";
        });
        expect(c.length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
    const navCall = ctrl.ws.send.mock.calls.find((args: string[]) => {
      const parsed = JSON.parse(args[0]) as { method: string };
      return parsed.method === "Page.navigate";
    });
    ctrl.message(JSON.stringify({ id: JSON.parse(navCall![0] as string).id, result: {} }));
    ctrl.message(JSON.stringify({ method: "Page.loadEventFired", params: {} }));

    await vi.waitFor(
      () => {
        const c = ctrl.ws.send.mock.calls.filter((args: string[]) => {
          const parsed = JSON.parse(args[0]) as { method: string };
          return parsed.method === "LP.getMarkdown";
        });
        expect(c.length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
    const mdCall = ctrl.ws.send.mock.calls.find((args: string[]) => {
      const parsed = JSON.parse(args[0]) as { method: string };
      return parsed.method === "LP.getMarkdown";
    });
    ctrl.message(
      JSON.stringify({
        id: JSON.parse(mdCall![0] as string).id,
        result: { markdown: "# Test Article\n\nThis is the article content." },
      }),
    );

    await vi.waitFor(
      () => {
        const c = ctrl.ws.send.mock.calls.filter((args: string[]) => {
          const parsed = JSON.parse(args[0]) as { method: string };
          return parsed.method === "Target.closeTarget";
        });
        expect(c.length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
    const closeCall = ctrl.ws.send.mock.calls.find((args: string[]) => {
      const parsed = JSON.parse(args[0]) as { method: string };
      return parsed.method === "Target.closeTarget";
    });
    ctrl.message(JSON.stringify({ id: JSON.parse(closeCall![0] as string).id, result: {} }));

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Test Article");
    expect(result!.markdown).toContain("This is the article content.");
  });

  it("should return null when LP.getMarkdown returns empty string", async () => {
    ctrl = makeController();
    vi.stubGlobal(
      "WebSocket",
      vi.fn(function () {
        return ctrl.ws;
      }),
    );
    const { tryObscura } = await import("../../extensions/link-summarizer/cdp.js");
    const promise = tryObscura("https://example.com");

    await vi.waitFor(() => expect(vi.mocked(globalThis.WebSocket)).toHaveBeenCalled(), {
      timeout: 1000,
    });
    ctrl.open();
    await vi.waitFor(() => expect(ctrl.ws.send).toHaveBeenCalled(), { timeout: 1000 });

    const createCall = ctrl.ws.send.mock.calls.find((args: string[]) => {
      const parsed = JSON.parse(args[0]) as { method: string };
      return parsed.method === "Target.createTarget";
    });
    ctrl.message(
      JSON.stringify({ id: JSON.parse(createCall![0] as string).id, result: { targetId: "t-1" } }),
    );

    await vi.waitFor(
      () => {
        const c = ctrl.ws.send.mock.calls.filter((args: string[]) => {
          const parsed = JSON.parse(args[0]) as { method: string };
          return parsed.method === "Target.attachToTarget";
        });
        expect(c.length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
    const attachCall = ctrl.ws.send.mock.calls.find((args: string[]) => {
      const parsed = JSON.parse(args[0]) as { method: string };
      return parsed.method === "Target.attachToTarget";
    });
    ctrl.message(
      JSON.stringify({ id: JSON.parse(attachCall![0] as string).id, result: { sessionId: "s-1" } }),
    );

    await vi.waitFor(
      () => {
        const c = ctrl.ws.send.mock.calls.filter((args: string[]) => {
          const parsed = JSON.parse(args[0]) as { method: string };
          return parsed.method === "Page.enable";
        });
        expect(c.length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
    const enableCall = ctrl.ws.send.mock.calls.find((args: string[]) => {
      const parsed = JSON.parse(args[0]) as { method: string };
      return parsed.method === "Page.enable";
    });
    ctrl.message(JSON.stringify({ id: JSON.parse(enableCall![0] as string).id, result: {} }));

    await vi.waitFor(
      () => {
        const c = ctrl.ws.send.mock.calls.filter((args: string[]) => {
          const parsed = JSON.parse(args[0]) as { method: string };
          return parsed.method === "Page.navigate";
        });
        expect(c.length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
    const navCall = ctrl.ws.send.mock.calls.find((args: string[]) => {
      const parsed = JSON.parse(args[0]) as { method: string };
      return parsed.method === "Page.navigate";
    });
    ctrl.message(JSON.stringify({ id: JSON.parse(navCall![0] as string).id, result: {} }));
    ctrl.message(JSON.stringify({ method: "Page.loadEventFired", params: {} }));

    await vi.waitFor(
      () => {
        const c = ctrl.ws.send.mock.calls.filter((args: string[]) => {
          const parsed = JSON.parse(args[0]) as { method: string };
          return parsed.method === "LP.getMarkdown";
        });
        expect(c.length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
    const mdCall = ctrl.ws.send.mock.calls.find((args: string[]) => {
      const parsed = JSON.parse(args[0]) as { method: string };
      return parsed.method === "LP.getMarkdown";
    });
    ctrl.message(
      JSON.stringify({ id: JSON.parse(mdCall![0] as string).id, result: { markdown: "" } }),
    );

    await vi.waitFor(
      () => {
        const c = ctrl.ws.send.mock.calls.filter((args: string[]) => {
          const parsed = JSON.parse(args[0]) as { method: string };
          return parsed.method === "Target.closeTarget";
        });
        expect(c.length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
    const closeCall = ctrl.ws.send.mock.calls.find((args: string[]) => {
      const parsed = JSON.parse(args[0]) as { method: string };
      return parsed.method === "Target.closeTarget";
    });
    ctrl.message(JSON.stringify({ id: JSON.parse(closeCall![0] as string).id, result: {} }));

    const result = await promise;
    expect(result).toBeNull();
  });
});
