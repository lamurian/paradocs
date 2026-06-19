/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";

/**
 * Tests for searchWeb — DuckDuckGo HTML endpoint via python subprocess.
 * Mocks pi.exec to return controlled JSON output.
 */

describe("searchWeb", () => {
  it("should return parsed results when pi.exec succeeds", async () => {
    const mockStdout = JSON.stringify([
      {
        title: "Quantum Computing Overview",
        url: "https://example.edu/quantum",
        snippet: "An overview of quantum computing.",
      },
      {
        title: "Machine Learning Basics",
        url: "https://example.edu/ml",
        snippet: "Introduction to machine learning.",
      },
    ]);

    const mockPi = {
      exec: vi.fn().mockResolvedValue({ stdout: mockStdout, code: 0 }),
    } as any;

    const { searchWeb } = await import("../../extensions/expand-bullets/search.js");
    const results = await searchWeb(mockPi, "quantum computing");

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Quantum Computing Overview");
    expect(results[0].url).toBe("https://example.edu/quantum");
    expect(results[0].snippet).toBe("An overview of quantum computing.");
    expect(results[1].title).toBe("Machine Learning Basics");
  });

  it("should return empty array when pi.exec returns non-zero exit code", async () => {
    const mockPi = {
      exec: vi.fn().mockResolvedValue({ stdout: "", code: 1 }),
    } as any;

    const { searchWeb } = await import("../../extensions/expand-bullets/search.js");
    const results = await searchWeb(mockPi, "test query");

    expect(results).toEqual([]);
  });

  it("should return empty array when pi.exec throws", async () => {
    const mockPi = {
      exec: vi.fn().mockRejectedValue(new Error("Python not found")),
    } as any;

    const { searchWeb } = await import("../../extensions/expand-bullets/search.js");
    const results = await searchWeb(mockPi, "test query");

    expect(results).toEqual([]);
  });

  it("should return empty array when JSON has error field", async () => {
    const mockStdout = JSON.stringify({ error: "Something went wrong" });
    const mockPi = {
      exec: vi.fn().mockResolvedValue({ stdout: mockStdout, code: 0 }),
    } as any;

    const { searchWeb } = await import("../../extensions/expand-bullets/search.js");
    const results = await searchWeb(mockPi, "test query");

    expect(results).toEqual([]);
  });

  it("should handle empty results array", async () => {
    const mockStdout = JSON.stringify([]);
    const mockPi = {
      exec: vi.fn().mockResolvedValue({ stdout: mockStdout, code: 0 }),
    } as any;

    const { searchWeb } = await import("../../extensions/expand-bullets/search.js");
    const results = await searchWeb(mockPi, "test query");

    expect(results).toEqual([]);
  });

  it("should pass the query string to pi.exec", async () => {
    const mockStdout = JSON.stringify([
      { title: "Result", url: "https://example.com", snippet: "Snippet" },
    ]);
    const mockPi = {
      exec: vi.fn().mockResolvedValue({ stdout: mockStdout, code: 0 }),
    } as any;

    const { searchWeb } = await import("../../extensions/expand-bullets/search.js");
    await searchWeb(mockPi, "machine learning basics");

    expect(mockPi.exec).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining([expect.any(String), "machine learning basics"]),
      expect.objectContaining({ timeout: 30_000 }),
    );
  });

  it("should handle result with missing snippet", async () => {
    const mockStdout = JSON.stringify([{ title: "Title Only", url: "https://example.com" }]);
    const mockPi = {
      exec: vi.fn().mockResolvedValue({ stdout: mockStdout, code: 0 }),
    } as any;

    const { searchWeb } = await import("../../extensions/expand-bullets/search.js");
    const results = await searchWeb(mockPi, "test");

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Title Only");
    expect(results[0].snippet).toBe("");
  });
});
