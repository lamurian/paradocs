/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for checkPdfContentType and tryExtractPdf.
 * Mocks fetch globally; mocks child_process and fs/promises via vi.mock.
 */

const mockExecSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: mockExecSync }));
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn().mockResolvedValue("/tmp/pi-pdf-test"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

const PDF_BYTES = new Uint8Array(
  Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF"),
);

function makeReader(): ReadableStreamDefaultReader {
  let done = false;
  return {
    read() {
      if (done) return Promise.resolve({ done: true, value: undefined as unknown as Uint8Array });
      done = true;
      return Promise.resolve({ done: false, value: PDF_BYTES });
    },
    cancel() {
      return Promise.resolve();
    },
    releaseLock() {},
    closed: Promise.resolve(undefined),
  };
}

// ─── checkPdfContentType ───────────────────────────────────────────────────

describe("checkPdfContentType", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should return true when content-type is application/pdf", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "application/pdf"]]),
      }),
    );
    const { checkPdfContentType } = await import("../../extensions/link-summarizer/pdf.js");
    expect(await checkPdfContentType("https://example.com/doc.pdf")).toBe(true);
  });

  it("should return false when content-type is not application/pdf", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "text/html"]]),
      }),
    );
    const { checkPdfContentType } = await import("../../extensions/link-summarizer/pdf.js");
    expect(await checkPdfContentType("https://example.com/doc.html")).toBe(false);
  });

  it("should return false when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const { checkPdfContentType } = await import("../../extensions/link-summarizer/pdf.js");
    expect(await checkPdfContentType("https://example.com/doc.pdf")).toBe(false);
  });

  it("should follow redirects", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([["content-type", "application/pdf"]]),
    });
    vi.stubGlobal("fetch", mockFetch);
    const { checkPdfContentType } = await import("../../extensions/link-summarizer/pdf.js");
    await checkPdfContentType("https://example.com/redirect");
    expect(mockFetch.mock.calls[0][1].redirect).toBe("follow");
  });

  it("should be case-insensitive for content-type match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "Application/PDF"]]),
      }),
    );
    const { checkPdfContentType } = await import("../../extensions/link-summarizer/pdf.js");
    expect(await checkPdfContentType("https://example.com/doc.pdf")).toBe(true);
  });
});

// ─── tryExtractPdf ─────────────────────────────────────────────────────────

describe("tryExtractPdf", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockExecSync.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should return null for non-PDF URL without PDF content type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "text/html"]]),
      }),
    );
    const { tryExtractPdf } = await import("../../extensions/link-summarizer/pdf.js");
    expect(await tryExtractPdf("https://example.com/doc.html")).toBeNull();
  });

  it("should detect PDF by /pdf/ path pattern without HEAD request", async () => {
    mockExecSync
      .mockReturnValueOnce("/usr/bin/pdftotext")
      .mockReturnValueOnce("PDF Title Here\n\nContent of the PDF document.");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => makeReader() },
      }),
    );

    const { tryExtractPdf } = await import("../../extensions/link-summarizer/pdf.js");
    const result = await tryExtractPdf("https://example.com/pdf/12345");

    expect(result).not.toBeNull();
    expect(result!.title).toBe("PDF Title Here");
  });

  it("should extract PDF when URL has .pdf extension", async () => {
    mockExecSync
      .mockReturnValueOnce("/usr/bin/pdftotext")
      .mockReturnValueOnce("Machine Learning Basics\n\nThis is the content.");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: { getReader: () => makeReader() },
      }),
    );

    const { tryExtractPdf } = await import("../../extensions/link-summarizer/pdf.js");
    const result = await tryExtractPdf("https://example.com/doc.pdf");

    expect(result).not.toBeNull();
    expect(result!.title).toBe("Machine Learning Basics");
  });

  it("should return message when pdftotext is not installed", async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("Command failed: which pdftotext");
    });

    const { tryExtractPdf } = await import("../../extensions/link-summarizer/pdf.js");
    const result = await tryExtractPdf("https://example.com/doc.pdf");

    expect(result).not.toBeNull();
    expect(result!.title).toBe("(PDF document)");
    expect(result!.text).toBe("pdftotext not installed.");
  });

  it("should return null when PDF download fails with 404", async () => {
    mockExecSync.mockReturnValueOnce("/usr/bin/pdftotext");

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map([["content-type", "application/pdf"]]),
        })
        .mockResolvedValueOnce({ ok: false, status: 404 }),
    );

    const { tryExtractPdf } = await import("../../extensions/link-summarizer/pdf.js");
    expect(await tryExtractPdf("https://example.com/404.pdf")).toBeNull();
  });

  it("should return null when fetch download throws", async () => {
    mockExecSync.mockReturnValueOnce("/usr/bin/pdftotext");

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map([["content-type", "application/pdf"]]),
        })
        .mockRejectedValueOnce(new Error("Network error")),
    );

    const { tryExtractPdf } = await import("../../extensions/link-summarizer/pdf.js");
    expect(await tryExtractPdf("https://example.com/doc.pdf")).toBeNull();
  });

  it("should return null when response body has no reader", async () => {
    mockExecSync.mockReturnValueOnce("/usr/bin/pdftotext");

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map([["content-type", "application/pdf"]]),
        })
        .mockResolvedValueOnce({ ok: true, body: null }),
    );

    const { tryExtractPdf } = await import("../../extensions/link-summarizer/pdf.js");
    expect(await tryExtractPdf("https://example.com/doc.pdf")).toBeNull();
  });
});
