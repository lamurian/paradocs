/**
 * Tests for the PARA outbox ingest path.
 *
 * Covers the pi-workflow implementation-complete event, the /para-ingest
 * command and the ingest_para_outbox tool, plus the read-only refusal that
 * must never touch KNOWLEDGE_DIR or notes.db.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IngestReport } from "../../common/ingest-finalize.ts";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const mocks = vi.hoisted(() => ({
  ensureNotesDb: vi.fn(),
  ingestOutbox: vi.fn(),
  formatIngestReport: vi.fn((report: { batches: string[]; created: string[] }) =>
    [
      `Ingest report: ${report.batches.length} batch(es)`,
      "Created:",
      ...(report.created.length > 0 ? report.created.map((path) => `  - ${path}`) : ["  (none)"]),
    ].join("\n"),
  ),
}));

vi.mock("../../common/notesDb.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../common/notesDb.ts")>();
  return { ...actual, ensureNotesDb: mocks.ensureNotesDb };
});

vi.mock("../../common/ingest.ts", () => ({ ingestOutbox: mocks.ingestOutbox }));

vi.mock("../../common/ingest-finalize.ts", () => ({
  formatIngestReport: mocks.formatIngestReport,
}));

interface SentMessage {
  customType: string;
  content: string;
  display: boolean;
}

interface RegisteredTool {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

interface RegisteredCommand {
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

interface FakePiHarness {
  pi: ExtensionAPI;
  tools: RegisteredTool[];
  commands: Record<string, RegisteredCommand>;
  handlers: Record<string, (data: unknown) => void>;
  messages: SentMessage[];
}

/** Build a fake pi API that captures tools, commands, events and messages. */
function createPi(): FakePiHarness {
  const tools: RegisteredTool[] = [];
  const commands: Record<string, RegisteredCommand> = {};
  const handlers: Record<string, (data: unknown) => void> = {};
  const messages: SentMessage[] = [];

  const pi = {
    registerTool: (tool: RegisteredTool) => {
      tools.push(tool);
    },
    registerCommand: (name: string, options: RegisteredCommand) => {
      commands[name] = options;
    },
    sendMessage: (message: SentMessage) => {
      messages.push(message);
    },
    events: {
      on: (channel: string, handler: (data: unknown) => void) => {
        handlers[channel] = handler;
        return () => {};
      },
    },
  } as unknown as ExtensionAPI;

  return { pi, tools, commands, handlers, messages };
}

/** Build a representative ingest report. */
function makeReport(overrides: Partial<IngestReport> = {}): IngestReport {
  return {
    batches: ["b-test"],
    created: ["Resources/created-note.md"],
    updated: [],
    skipped: [],
    conflicts: [],
    conflictPaths: [],
    citationsAdded: [],
    commit: null,
    ...overrides,
  };
}

const envKeys = [
  "PARADOCS_READONLY",
  "PI_UNIT_FILE",
  "PI_CONTRACT_GUARD_FILE",
  "KNOWLEDGE_DIR",
  "KNOWLEDGE_DB",
] as const;

describe("para-outbox ingest tool", () => {
  const originalEnv: Record<string, string | undefined> = {};
  let tmpDir: string;
  let knowledgeDir: string;

  beforeEach(() => {
    for (const key of envKeys) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }

    tmpDir = mkdtempSync(join(tmpdir(), "ingest-tool-test-"));
    knowledgeDir = join(tmpDir, "knowledge");
    process.env.KNOWLEDGE_DIR = knowledgeDir;
    process.env.KNOWLEDGE_DB = "notes.db";

    mocks.ensureNotesDb.mockReset();
    mocks.ingestOutbox.mockReset();
    mocks.ensureNotesDb.mockResolvedValue({ fake: "db" });
    mocks.ingestOutbox.mockResolvedValue(makeReport());
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
  });

  /** Import the extension entry point with populated event handlers. */
  async function loadExtension(): Promise<FakePiHarness> {
    const harness = createPi();
    const module = await import("../../extensions/para-outbox/index.ts");
    module.default(harness.pi);
    return harness;
  }

  it("ingests the event cwd outbox and posts a paradocs-ingest message", async () => {
    const harness = await loadExtension();

    harness.handlers["workflow:implementation_complete"]({ cwd: "/project/from-event" });

    await vi.waitFor(() => expect(harness.messages).toHaveLength(1));

    expect(mocks.ensureNotesDb).toHaveBeenCalledWith("/project/from-event");
    expect(mocks.ingestOutbox).toHaveBeenCalledWith("/project/from-event", {
      knowledgeDir,
      db: { fake: "db" },
      now: expect.any(Date) as Date,
    });
    expect(harness.messages[0]).toMatchObject({
      customType: "paradocs-ingest",
      display: true,
    });
    expect(harness.messages[0].content).toContain("Ingest report: 1 batch(es)");
    expect(harness.messages[0].content).toContain("Resources/created-note.md");
  });

  it("falls back to process.cwd when the event has no cwd", async () => {
    const harness = await loadExtension();

    harness.handlers["workflow:implementation_complete"](undefined);

    await vi.waitFor(() => expect(mocks.ingestOutbox).toHaveBeenCalled());
    expect(mocks.ingestOutbox).toHaveBeenCalledWith(process.cwd(), expect.any(Object));
  });

  it("runs the same ingest from the /para-ingest command", async () => {
    const harness = await loadExtension();
    const command = harness.commands["para-ingest"];
    expect(command).toBeDefined();

    await command.handler("", {
      cwd: "/project/from-command",
    } as unknown as ExtensionCommandContext);

    expect(mocks.ensureNotesDb).toHaveBeenCalledWith("/project/from-command");
    expect(mocks.ingestOutbox).toHaveBeenCalledWith("/project/from-command", expect.any(Object));
    expect(harness.messages).toHaveLength(1);
    expect(harness.messages[0].customType).toBe("paradocs-ingest");
  });

  it("returns the report from the ingest_para_outbox tool", async () => {
    const harness = await loadExtension();
    const tool = harness.tools.find((candidate) => candidate.name === "ingest_para_outbox");
    expect(tool).toBeDefined();

    const result = await tool?.execute("call-1", {}, undefined, undefined, {
      cwd: "/project/from-tool",
    } as unknown as ExtensionContext);

    expect(mocks.ingestOutbox).toHaveBeenCalledWith("/project/from-tool", expect.any(Object));
    expect(result?.content[0].text).toContain("Ingest report: 1 batch(es)");
    expect(harness.messages).toHaveLength(1);
  });

  it.each(["PARADOCS_READONLY", "PI_UNIT_FILE", "PI_CONTRACT_GUARD_FILE"] as const)(
    "refuses ingest in a read-only process (%s) without touching the knowledge base",
    async (key) => {
      process.env[key] = "1";
      const { runIngest, READ_ONLY_INGEST_MESSAGE } =
        await import("../../extensions/para-outbox/ingest-tool.ts");
      const harness = createPi();

      const result = await runIngest(harness.pi, "/project/read-only");

      expect(result).toBe(READ_ONLY_INGEST_MESSAGE);
      expect(mocks.ensureNotesDb).not.toHaveBeenCalled();
      expect(mocks.ingestOutbox).not.toHaveBeenCalled();
      expect(harness.messages).toHaveLength(0);
      expect(existsSync(knowledgeDir)).toBe(false);
      expect(existsSync(join(knowledgeDir, "notes.db"))).toBe(false);
    },
  );
});
