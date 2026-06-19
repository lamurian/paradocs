import { describe, it, expect } from "vitest";

describe("isPdfUrl", () => {
  it("should detect .pdf extension", async () => {
    const { isPdfUrl } = await import("../../extensions/link-summarizer/pdf.js");
    expect(isPdfUrl("https://example.com/doc.pdf")).toBe(true);
    expect(isPdfUrl("https://example.com/doc.PDF")).toBe(true);
  });

  it("should handle .pdf URLs with query string and fragment", async () => {
    const { isPdfUrl } = await import("../../extensions/link-summarizer/pdf.js");
    expect(isPdfUrl("https://example.com/doc.pdf?query=1")).toBe(true);
    expect(isPdfUrl("https://example.com/doc.pdf#section=2")).toBe(true);
  });

  it("should detect /pdf/ path pattern", async () => {
    const { isPdfUrl } = await import("../../extensions/link-summarizer/pdf.js");
    expect(isPdfUrl("https://example.com/pdf/12345")).toBe(true);
    expect(isPdfUrl("https://example.com/pdf/12345v2")).toBe(true);
    expect(isPdfUrl("https://example.com/pdf/10.1000")).toBe(true);
  });

  it("should return false for non-PDF URLs", async () => {
    const { isPdfUrl } = await import("../../extensions/link-summarizer/pdf.js");
    expect(isPdfUrl("https://example.com/doc.html")).toBe(false);
    expect(isPdfUrl("https://example.com/page")).toBe(false);
    expect(isPdfUrl("https://example.com/pdf")).toBe(false);
  });

  it("should return false for invalid URLs", async () => {
    const { isPdfUrl } = await import("../../extensions/link-summarizer/pdf.js");
    expect(isPdfUrl("not a url")).toBe(false);
    expect(isPdfUrl("")).toBe(false);
  });
});

describe("extractPdfTitle", () => {
  it("should return first line with more than 10 characters as title", async () => {
    const { extractPdfTitle } = await import("../../extensions/link-summarizer/pdf.js");
    const text = `Machine Learning Fundamentals
Chapter 1: Introduction
This is the first paragraph.`;
    expect(extractPdfTitle(text)).toBe("Machine Learning Fundamentals");
  });

  it("should return fallback for empty text", async () => {
    const { extractPdfTitle } = await import("../../extensions/link-summarizer/pdf.js");
    expect(extractPdfTitle("")).toBe("(PDF document)");
  });

  it("should return fallback when all lines are too short", async () => {
    const { extractPdfTitle } = await import("../../extensions/link-summarizer/pdf.js");
    expect(extractPdfTitle("a\nbb")).toBe("(PDF document)");
  });

  it("should trim whitespace from extracted title", async () => {
    const { extractPdfTitle } = await import("../../extensions/link-summarizer/pdf.js");
    const text = `  A Title With Extra Spaces  \n\nSome content here that is long enough.`;
    expect(extractPdfTitle(text)).toBe("A Title With Extra Spaces");
  });

  it("should skip blank lines", async () => {
    const { extractPdfTitle } = await import("../../extensions/link-summarizer/pdf.js");
    const text = `\n\n\nActual Title Here\nContent follows.`;
    expect(extractPdfTitle(text)).toBe("Actual Title Here");
  });
});
