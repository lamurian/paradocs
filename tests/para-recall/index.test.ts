import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PARADOCS_CONFIG } from "../../common/config.ts";

import type { ParadocsConfig } from "../../common/config.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const mocks = vi.hoisted(() => ({
  openNotesDbReadOnly: vi.fn(),
  loadParadocsConfig: vi.fn(),
  runRecall: vi.fn(),
  getKnowledgeConfig: vi.fn(),
}));

vi.mock("../../common/notesDb.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../common/notesDb.ts")>();
  return { ...actual, openNotesDbReadOnly: mocks.openNotesDbReadOnly };
});

vi.mock("../../common/config.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../common/config.ts")>();
  return { ...actual, loadParadocsConfig: mocks.loadParadocsConfig };
});

vi.mock("../../common/env.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../common/env.ts")>();
  return { ...actual, getKnowledgeConfig: mocks.getKnowledgeConfig };
});

vi.mock("../../common/recall.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../common/recall.ts")>();
  return { ...actual, runRecall: mocks.runRecall };
});

type Handler = (event: { prompt: string }, ctx: { cwd: string }) => unknown;

/** Register the extension and return its before_agent_start handler. */
async function registerHandler(): Promise<Handler> {
  const handlers: Record<string, Handler> = {};
  const fakePi = {
    on: (name: string, handler: Handler) => {
      handlers[name] = handler;
    },
  } as unknown as ExtensionAPI;

  const { default: paraRecall } = await import("../../extensions/para-recall/index.ts");
  paraRecall(fakePi);
  return handlers.before_agent_start;
}

/** Build a full config with optional recall overrides. */
function makeConfig(recall: Partial<ParadocsConfig["recall"]> = {}): ParadocsConfig {
  return {
    freshness: { ...DEFAULT_PARADOCS_CONFIG.freshness },
    recall: { ...DEFAULT_PARADOCS_CONFIG.recall, ...recall },
    note: { ...DEFAULT_PARADOCS_CONFIG.note },
  };
}

describe("para-recall before_agent_start", () => {
  beforeEach(() => {
    mocks.openNotesDbReadOnly.mockReset();
    mocks.loadParadocsConfig.mockReset();
    mocks.runRecall.mockReset();
    mocks.getKnowledgeConfig.mockReset();

    mocks.getKnowledgeConfig.mockReturnValue({ dir: "/kb", db: "notes.db" });
    mocks.loadParadocsConfig.mockReturnValue({ config: makeConfig(), issues: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("injects the recall block as a hidden paradocs-recall message", async () => {
    const db = { fake: "db" };
    mocks.openNotesDbReadOnly.mockReturnValue(db);
    mocks.runRecall.mockReturnValue({ block: "KB recall (paradocs): hit", hits: 1 });
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(10);
    const handler = await registerHandler();

    const result = await handler({ prompt: "typescript database reasoning" }, { cwd: "/project" });

    expect(mocks.openNotesDbReadOnly).toHaveBeenCalledWith("/project");
    expect(mocks.loadParadocsConfig).toHaveBeenCalledWith("/kb");
    expect(mocks.runRecall).toHaveBeenCalledWith(
      "typescript database reasoning",
      db,
      expect.objectContaining({ recall: makeConfig().recall }),
      expect.any(Date),
    );
    expect(result).toEqual({
      message: {
        customType: "paradocs-recall",
        content: "KB recall (paradocs): hit",
        display: false,
      },
    });
  });

  it("returns nothing when notes.db is missing", async () => {
    mocks.openNotesDbReadOnly.mockReturnValue(null);
    const handler = await registerHandler();

    const result = await handler({ prompt: "typescript database reasoning" }, { cwd: "/project" });

    expect(result).toBeUndefined();
    expect(mocks.runRecall).not.toHaveBeenCalled();
  });

  it("returns nothing when recall exceeds timeoutMs", async () => {
    mocks.openNotesDbReadOnly.mockReturnValue({ fake: "db" });
    mocks.runRecall.mockReturnValue({ block: "late", hits: 1 });
    mocks.loadParadocsConfig.mockReturnValue({
      config: makeConfig({ timeoutMs: 150 }),
      issues: [],
    });
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(151);
    const handler = await registerHandler();

    const result = await handler({ prompt: "typescript database reasoning" }, { cwd: "/project" });

    expect(result).toBeUndefined();
  });

  it("returns nothing when runRecall finds no hits", async () => {
    mocks.openNotesDbReadOnly.mockReturnValue({ fake: "db" });
    mocks.runRecall.mockReturnValue(null);
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(10);
    const handler = await registerHandler();

    const result = await handler({ prompt: "typescript database reasoning" }, { cwd: "/project" });

    expect(result).toBeUndefined();
  });
});
