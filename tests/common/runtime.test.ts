/**
 * Tests for common/runtime.ts — read-only process detection.
 */

import { describe, expect, it } from "vitest";

import { isReadOnlyProcess } from "../../common/runtime.ts";

describe("isReadOnlyProcess", () => {
  it("is false for an empty environment", () => {
    expect(isReadOnlyProcess({})).toBe(false);
  });

  it("is true when PARADOCS_READONLY is 1", () => {
    expect(isReadOnlyProcess({ PARADOCS_READONLY: "1" })).toBe(true);
  });

  it("is true when PI_UNIT_FILE is non-empty", () => {
    expect(isReadOnlyProcess({ PI_UNIT_FILE: "unit.md" })).toBe(true);
  });

  it("is true when PI_CONTRACT_GUARD_FILE is non-empty", () => {
    expect(isReadOnlyProcess({ PI_CONTRACT_GUARD_FILE: "guard.json" })).toBe(true);
  });

  it("ignores empty unit/guard variables and other PARADOCS_READONLY values", () => {
    expect(
      isReadOnlyProcess({
        PARADOCS_READONLY: "0",
        PI_UNIT_FILE: "",
        PI_CONTRACT_GUARD_FILE: "",
      }),
    ).toBe(false);
  });
});
