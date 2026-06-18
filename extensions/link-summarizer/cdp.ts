/**
 * CDP (Chrome DevTools Protocol) client for Obscura headless browser.
 * Connects via WebSocket to Obscura's CDP server and uses LP.getMarkdown
 * for native Markdown extraction.
 */

const OBSCURA_CDP_URL = "ws://127.0.0.1:9222/devtools/browser";

class CdpConnection {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  private eventHandlers = new Map<string, (params: unknown) => void>();
  private timeoutMs: number;

  constructor(timeoutMs = 30_000) {
    this.timeoutMs = timeoutMs;
  }

  connect(url: string, connectTimeoutMs = 5_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connection timeout")), connectTimeoutMs);
      try {
        this.ws = new WebSocket(url);
        this.ws.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
        this.ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error("CDP connection error"));
        };
        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string);
            if (msg.id !== undefined && this.pending.has(msg.id)) {
              const h = this.pending.get(msg.id)!;
              this.pending.delete(msg.id);
              if (msg.error) h.reject(new Error(msg.error.message));
              else h.resolve(msg.result);
            } else if (msg.method && this.eventHandlers.has(msg.method)) {
              this.eventHandlers.get(msg.method)!(msg.params);
            }
          } catch {
            /* malformed message */
          }
        };
        this.ws.onclose = () => {
          for (const [, h] of this.pending) h.reject(new Error("CDP connection closed"));
          this.pending.clear();
        };
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  async send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<unknown> {
    const id = this.nextId++;
    const msg: Record<string, unknown> = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws!.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  on(event: string, handler: (params: unknown) => void): void {
    this.eventHandlers.set(event, handler);
  }
  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

/**
 * Fetch a URL via Obscura's CDP server using LP.getMarkdown.
 * Returns null if Obscura is not running or the page fails to load.
 */
export async function tryObscura(
  url: string,
  signal?: AbortSignal,
): Promise<{ title: string; markdown: string } | null> {
  if (signal?.aborted) return null;

  const cdp = new CdpConnection(30_000);
  try {
    await cdp.connect(OBSCURA_CDP_URL, 5_000);

    const { targetId } = (await cdp.send("Target.createTarget", { url: "about:blank" })) as {
      targetId?: string;
    };
    if (!targetId) return null;

    const { sessionId } = (await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as { sessionId?: string };
    if (!sessionId) {
      await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
      return null;
    }

    await cdp.send("Page.enable", {}, sessionId);

    let loaded = false;
    const loadEvent = new Promise<void>((resolve) => {
      cdp.on("Page.loadEventFired", () => {
        loaded = true;
        resolve();
      });
      cdp.on("Page.frameStoppedLoading", () => {
        if (!loaded) {
          loaded = true;
          resolve();
        }
      });
    });

    await cdp.send("Page.navigate", { url }, sessionId);
    await Promise.race([
      loadEvent,
      new Promise<void>((_, reject) => {
        if (signal)
          signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
      }),
    ]);

    const result = (await cdp.send("LP.getMarkdown", {}, sessionId)) as
      | { markdown?: string }
      | undefined;
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});

    const markdown = result?.markdown?.trim();
    if (!markdown) return null;

    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    return { title: titleMatch ? titleMatch[1].trim() : "(untitled)", markdown };
  } catch {
    return null;
  } finally {
    cdp.close();
  }
}
