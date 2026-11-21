import { describe, it, expect } from "vitest";

import { validateStagedNote } from "../../common/stage-validate.ts";

import type { StageNoteInput, StageValidationContext } from "../../common/stage-validate.ts";

/** Build a valid create input with overridable fields. */
function createInput(overrides: Partial<StageNoteInput> = {}): StageNoteInput {
  return {
    mode: "create",
    title: "A valid note",
    description: "A short description",
    tags: ["knowledge-management"],
    area: "Resources",
    summary: ["A summary paragraph."],
    keyPoints: ["A key point."],
    ...overrides,
  };
}

/** Build a context with no external conflicts. */
function createContext(overrides: Partial<StageValidationContext> = {}): StageValidationContext {
  return {
    knownCitekeys: new Set<string>(),
    stagedCitekeys: new Set<string>(),
    maxContentLines: 60,
    findDuplicate: () => null,
    targetExists: () => true,
    ...overrides,
  };
}

describe("validateStagedNote", () => {
  it("rejects content over maxContentLines and reports the overage", () => {
    const errors = validateStagedNote(
      createInput(),
      { contentLines: 65, citekeys: [] },
      createContext({ maxContentLines: 60 }),
    );

    expect(errors).toContain("content is 65 lines, 5 over the limit of 60");
  });

  it("rejects citekeys absent from the knowledge base and staged citations", () => {
    const errors = validateStagedNote(
      createInput(),
      { contentLines: 5, citekeys: ["knownKey", "stagedKey", "missingKey"] },
      createContext({
        knownCitekeys: new Set(["knownKey"]),
        stagedCitekeys: new Set(["stagedKey"]),
      }),
    );

    expect(errors).toEqual(["unknown citekey @missingKey"]);
  });

  it("rejects a duplicate create title and names the existing path", () => {
    const errors = validateStagedNote(
      createInput({ title: "Existing note" }),
      { contentLines: 5, citekeys: [] },
      createContext({ findDuplicate: () => "Resources/existing-note.md" }),
    );

    expect(errors).toContain(
      "a note with this title exists: Resources/existing-note.md; stage an update instead",
    );
  });

  it("rejects an update whose target does not exist", () => {
    const errors = validateStagedNote(
      createInput({ mode: "update", targetPath: "Resources/missing.md" }),
      { contentLines: 5, citekeys: [] },
      createContext({ targetExists: () => false }),
    );

    expect(errors.length).toBeGreaterThan(0);
  });
});
