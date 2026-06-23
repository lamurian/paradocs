/**
 * Tests for /research command sufficiency flow — createNote / notes[] handling.
 *
 * Separate from research.test.ts to avoid vi.mock() hoisting conflicts
 * with the existing tests that don't mock these modules.
 *
 * @module tests/commands/research-sufficiency.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module-level mocks ────────────────────────────────────────────

const mockCreateDocument = vi.fn().mockResolvedValue({
  path: "Resources/test.md",
  title: "Test",
  linkCount: 1,
  indexOk: true,
});

const mockEnsureNotesDb = vi.fn().mockResolvedValue({
  exec: vi.fn(),
  close: vi.fn(),
});

const mockSearchDocs = vi.fn().mockReturnValue([]);

vi.mock("../../common/createDocument.js", () => ({
  createDocument: mockCreateDocument,
}));

vi.mock("../../common/notesDb.js", () => ({
  ensureNotesDb: mockEnsureNotesDb,
}));

vi.mock("../../extensions/para-knowledge/db-sqlite.js", () => ({
  searchDocs: mockSearchDocs,
}));

// ── Tests ─────────────────────────────────────────────────────────

describe("research handler — sufficiency flow", () => {
  let sendUserMessage: ReturnType<typeof vi.fn>;
  let notify: ReturnType<typeof vi.fn>;
  let custom: ReturnType<typeof vi.fn>;
  let mockPi: Record<string, unknown>;
  let mockCtx: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendUserMessage = vi.fn();
    notify = vi.fn();
    custom = vi.fn();

    mockCtx = {
      ui: { notify, custom },
      model: { id: "gpt-4o", provider: "openai" },
      modelRegistry: {
        getApiKeyAndHeaders: vi.fn().mockResolvedValue({
          ok: true,
          apiKey: "sk-test",
          headers: {},
        }),
      },
      cwd: "/tmp/test-cwd",
    };
    mockPi = { sendUserMessage, registerCommand: vi.fn() };
  });

  it("should create multiple documents when createNote with notes[] is returned", async () => {
    custom.mockResolvedValue({
      sufficient: true,
      rationale: "Novel synthesis across docs.",
      answer: "Comprehensive answer about the topic.",
      createNote: true,
      notes: [
        { title: "Note One", content: "Content one.", tags: ["tag1"] },
        { title: "Note Two", content: "Content two.", tags: ["tag2"] },
        { title: "Note Three", content: "Content three.", tags: ["tag3"] },
      ],
    });

    const { createHandler } = await import("../../extensions/commands/research.js");
    const handler = createHandler(mockPi as never);
    await handler("integrated farming", mockCtx as never);

    expect(mockCreateDocument).toHaveBeenCalledTimes(3);
    expect(mockCreateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Note One",
        content: "Content one.",
        tags: ["tag1"],
      }),
      { cwd: "/tmp/test-cwd" },
    );
    expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Created 3 atomic notes"));
  });

  it("should create single document when legacy createNote with noteContent is returned", async () => {
    custom.mockResolvedValue({
      sufficient: true,
      rationale: "Novel synthesis.",
      answer: "Answer about topic.",
      createNote: true,
      noteTitle: "Single Note",
      noteContent: "Single note content.",
      noteTags: ["tag1"],
    });

    const { createHandler } = await import("../../extensions/commands/research.js");
    const handler = createHandler(mockPi as never);
    await handler("some topic", mockCtx as never);

    expect(mockCreateDocument).toHaveBeenCalledTimes(1);
    expect(mockCreateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Single Note",
        content: "Single note content.",
        tags: ["tag1"],
      }),
      { cwd: "/tmp/test-cwd" },
    );
    expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("New note created"));
  });

  it("should not create any document when createNote is false/undefined", async () => {
    custom.mockResolvedValue({
      sufficient: true,
      rationale: "Existing docs cover it.",
      answer: "Answer from existing knowledge.",
    });

    const { createHandler } = await import("../../extensions/commands/research.js");
    const handler = createHandler(mockPi as never);
    await handler("existing topic", mockCtx as never);

    expect(mockCreateDocument).not.toHaveBeenCalled();
    expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("no new note created"));
  });

  it("should handle cancelled sufficiency check (null result)", async () => {
    custom.mockResolvedValue(null);

    const { createHandler } = await import("../../extensions/commands/research.js");
    const handler = createHandler(mockPi as never);
    await handler("cancelled topic", mockCtx as never);

    expect(notify).toHaveBeenCalledWith("Research cancelled.", "info");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });
});
