/**
 * Tests for common/url canonicalization and registrable-domain extraction.
 *
 * Ported from the former research-engine fetcher and domain tests.
 *
 * @module tests/common/url.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { fetchUrlAsText, fetchUrlWithTimeout } from "../../common/fetchUrl.ts";
import { canonicalizeUrl, registrableDomain } from "../../common/url.ts";
import { tryObscura } from "../../extensions/link-summarizer/cdp.ts";
import { fetchViaHttp } from "../../extensions/link-summarizer/http.ts";
import { tryExtractPdf } from "../../extensions/link-summarizer/pdf.ts";

vi.mock("../../extensions/link-summarizer/cdp.ts", () => ({ tryObscura: vi.fn() }));
vi.mock("../../extensions/link-summarizer/http.ts", () => ({ fetchViaHttp: vi.fn() }));
vi.mock("../../extensions/link-summarizer/pdf.ts", () => ({
  tryExtractPdf: vi.fn(),
  isPdfUrl: vi.fn((url: string) => url.endsWith(".pdf")),
}));

describe("canonicalizeUrl", () => {
  it("should strip utm params, trailing slashes, and arXiv v-suffixes to one key", () => {
    const a = canonicalizeUrl("https://blog.promptessor.com/guide/?utm_source=x&utm_medium=y");
    const b = canonicalizeUrl("https://blog.promptessor.com/guide");
    expect(a).toBe(b);
    expect(a).toBe("https://blog.promptessor.com/guide");

    const v1 = canonicalizeUrl("https://www.arxiv.org/abs/2604.05229v1");
    const bare = canonicalizeUrl("https://arxiv.org/abs/2604.05229");
    expect(v1).toBe(bare);
    expect(v1).toBe("https://arxiv.org/abs/2604.05229");
  });

  it("should preserve meaningful query params and fragments are dropped", () => {
    expect(canonicalizeUrl("https://x.com/a?id=5#frag")).toBe("https://x.com/a?id=5");
  });

  it("should return trimmed input for unparseable URLs", () => {
    expect(canonicalizeUrl("  htp:/bad  ")).toBe("htp:/bad");
  });

  it("should drop a bare root trailing slash", () => {
    expect(canonicalizeUrl("https://x.com/")).toBe("https://x.com");
    expect(canonicalizeUrl("https://x.com/?utm_source=a")).toBe("https://x.com");
    expect(canonicalizeUrl("https://x.com/a/?utm_source=a&id=5")).toBe("https://x.com/a/?id=5");
  });
});

describe("registrableDomain — lightweight eTLD+1", () => {
  it("should map arxiv abs URLs to arxiv.org", () => {
    expect(registrableDomain("https://www.arxiv.org/abs/2604.05229v1")).toBe("arxiv.org");
  });

  it("should map subdomains to the registrable domain", () => {
    expect(registrableDomain("https://blog.promptessor.com/guide?utm_source=x")).toBe(
      "promptessor.com",
    );
    expect(registrableDomain("https://docs.nvidia.com/x")).toBe("nvidia.com");
  });

  it("should handle second-level registry suffixes (co.uk)", () => {
    expect(registrableDomain("https://www.example.co.uk/a")).toBe("example.co.uk");
    expect(registrableDomain("https://www.governance.ac.uk/paper")).toBe("governance.ac.uk");
  });

  it("should return the host itself for two-label domains", () => {
    expect(registrableDomain("https://genai.owasp.org/")).toBe("owasp.org");
  });

  it("should return '' for unparseable input", () => {
    expect(registrableDomain("not a url")).toBe("");
  });

  it("should count distinct domains across mixed hosts", () => {
    const urls = [
      "https://arxiv.org/abs/2604.05229",
      "https://www.arxiv.org/abs/2506.04133",
      "https://arxiv.org/pdf/2608.19266",
      "https://sysdig.com/learn-cloud-native/agentic-ai-security",
      "https://docs.nvidia.com/nemo/guardrails/overview",
    ];
    const distinct = new Set(urls.map(registrableDomain));
    expect(distinct.size).toBe(3);
  });
});

describe("shared fetchUrl extraction branches", () => {
  const obscura = vi.mocked(tryObscura);
  const http = vi.mocked(fetchViaHttp);
  const pdf = vi.mocked(tryExtractPdf);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should extract a URL-detected PDF and truncate oversized text", async () => {
    pdf.mockResolvedValue({ title: "Paper", text: "x".repeat(80_001) });

    const result = await fetchUrlAsText("https://example.com/paper.pdf");

    expect("content" in result).toBe(true);
    if ("content" in result) {
      expect(result.engine).toBe("pdftotext");
      expect(result.content).toContain("content truncated");
    }
  });

  it("should fall back to Obscura markdown when PDF extraction misses", async () => {
    pdf.mockResolvedValue(null);
    obscura.mockResolvedValue({ title: "Rendered", markdown: "# Heading\n\nBody" });

    const result = await fetchUrlAsText("https://example.com/paper.pdf");

    expect("content" in result).toBe(true);
    if ("content" in result) {
      expect(result.engine).toBe("obscura-cdp");
      expect(result.title).toBe("Rendered");
    }
  });

  it("should retry PDF extraction when HTTP reports a PDF content type", async () => {
    obscura.mockResolvedValue(null);
    http.mockResolvedValue({ error: "PDF_CONTENT_TYPE" });
    pdf.mockResolvedValue({ title: "Inline PDF", text: "pdf text" });

    const result = await fetchUrlAsText("https://example.com/download");

    expect("content" in result).toBe(true);
    if ("content" in result) expect(result.engine).toBe("pdftotext");
  });

  it("should surface the HTTP error when a PDF fallback also fails", async () => {
    obscura.mockResolvedValue(null);
    http.mockResolvedValue({ error: "PDF_CONTENT_TYPE" });
    pdf.mockResolvedValue(null);

    const result = await fetchUrlAsText("https://example.com/download");

    expect(result).toEqual({ error: "PDF_CONTENT_TYPE" });
  });

  it("should surface a plain HTTP error", async () => {
    obscura.mockResolvedValue(null);
    http.mockResolvedValue({ error: "Network down" });

    const result = await fetchUrlAsText("https://example.com/page");

    expect(result).toEqual({ error: "Network down" });
  });

  it("should use the no-title fallback for the HTTP engine", async () => {
    obscura.mockResolvedValue(null);
    http.mockResolvedValue({ title: "", text: "plain body" });

    const result = await fetchUrlAsText("https://example.com/page");

    expect("content" in result).toBe(true);
    if ("content" in result) {
      expect(result.engine).toBe("http-fallback");
      expect(result.title).toBe("(no title)");
    }
  });

  it("should cancel immediately when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await fetchUrlWithTimeout("https://example.com/slow", 5000, controller.signal);

    expect(result).toEqual({ error: "Cancelled by caller" });
  });

  it("should cancel when the caller aborts mid-flight", async () => {
    obscura.mockResolvedValue(null);
    http.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();

    const pending = fetchUrlWithTimeout("https://example.com/slow", 5000, controller.signal);
    controller.abort();

    expect(await pending).toEqual({ error: "Cancelled by caller" });
  });
});
