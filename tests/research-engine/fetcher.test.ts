/**
 * Tests for research-engine fetcher: canonicalization (T7), deterministic
 * metadata extraction (T8), boilerplate stripping, and the fetch runner.
 *
 * @module tests/research-engine/fetcher.test
 */

import { describe, it, expect, vi } from "vitest";

import {
  canonicalizeUrl,
  extractMetadata,
  stripBoilerplate,
  isAuthoritative,
  fetchRecords,
} from "../../extensions/research-engine/fetcher.js";

describe("canonicalizeUrl (T7)", () => {
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
});

describe("extractMetadata (T8)", () => {
  it("should derive title, authors, and year from citation meta tags", () => {
    const html = `
      <html><head>
        <title>Ignored HTML title</title>
        <meta name="citation_title" content="From Governance Norms to Controls">
        <meta name="citation_author" content="Doe, Jane">
        <meta name="citation_date" content="2026-03-01">
      </head></html>`;
    const meta = extractMetadata(html, "https://example.com/paper");
    expect(meta.title).toBe("From Governance Norms to Controls");
    expect(meta.authors).toEqual(["Doe, Jane"]);
    expect(meta.year).toBe(2026);
  });

  it("should derive year/month from arXiv IDs when no meta tags exist", () => {
    const meta = extractMetadata("plain markdown body", "https://arxiv.org/abs/2506.04133");
    expect(meta.year).toBe(2025);
    expect(meta.month).toBe(6);
  });

  it("should read JSON-LD datePublished", () => {
    const meta = extractMetadata(
      `<script type="application/ld+json">{"datePublished": "2025-11-20"}</script>`,
      "https://blog.example.com/post",
    );
    expect(meta.year).toBe(2025);
  });

  it("should fall back to the HTML title tag", () => {
    const meta = extractMetadata("<title>My Guide</title><body>hi</body>", "https://x.com/g");
    expect(meta.title).toBe("My Guide");
  });

  it("should leave year undefined for undatable pages", () => {
    const meta = extractMetadata("no markers here at all", "https://vendor.example.com/page");
    expect(meta.year).toBeUndefined();
  });
});

describe("isAuthoritative", () => {
  it("should treat tier 1/2 results and academic domains as authoritative", () => {
    expect(isAuthoritative("https://random-blog.example.com/x", 1)).toBe(true);
    expect(isAuthoritative("https://random-blog.example.com/x", 2)).toBe(true);
    expect(isAuthoritative("https://random-blog.example.com/x", 3)).toBe(false);
    expect(isAuthoritative("https://cs.stanford.edu/paper", 3)).toBe(true);
    expect(isAuthoritative("https://arxiv.org/abs/1234.5678", 3)).toBe(true);
  });
});

describe("stripBoilerplate", () => {
  it("should remove images, nav lines, and collapse blank runs", () => {
    const text = [
      "# Title",
      "",
      "",
      "",
      "![logo](https://x.com/logo.png)",
      "Sign in",
      "Real content line.",
      "",
      "",
      "",
      "More content.",
    ].join("\n");
    const out = stripBoilerplate(text);
    expect(out).not.toContain("![");
    expect(out).not.toContain("Sign in");
    expect(out).toContain("Real content line.");
    expect(out).not.toContain("\n\n\n");
  });
});

describe("fetchRecords", () => {
  it("should record metadata on success and typed errors on failure", async () => {
    const fetchFn = vi.fn(
      (url: string): Promise<{ title?: string; content?: string; error?: string }> =>
        url.includes("bad")
          ? Promise.resolve({ error: "Request timed out after 20000ms" })
          : Promise.resolve({
              content: '<title>T</title><meta name="citation_date" content="2026-01-02">',
            }),
    );
    const records = await fetchRecords(["https://ok.example.com/a", "https://bad.example.com/b"], {
      fetchFn,
      concurrency: 2,
      tiers: new Map([["https://ok.example.com/a", 1]]),
      now: () => 1000,
    });
    expect(records[0].ok).toBe(true);
    expect(records[0].title).toBe("T");
    expect(records[0].year).toBe(2026);
    expect(records[0].tier).toBe(1);
    expect(records[1].ok).toBe(false);
    expect(records[1].error).toContain("timed out");
  });

  it("should record thrown errors without failing the batch", async () => {
    const fetchFn = vi.fn((): Promise<never> => Promise.reject(new Error("ECONNREFUSED")));
    const records = await fetchRecords(["https://x.example.com/"], { fetchFn });
    expect(records[0].ok).toBe(false);
    expect(records[0].error).toBe("ECONNREFUSED");
  });

  it("should leave tier undefined when no tier map entry exists", async () => {
    const fetchFn = vi.fn((): Promise<{ content: string }> => Promise.resolve({ content: "body" }));
    const records = await fetchRecords(["https://t.example.com/"], { fetchFn });
    expect(records[0].ok).toBe(true);
    expect(records[0].tier).toBeUndefined();
  });
});

describe("extractMetadata — attribute-order robustness", () => {
  it("should read meta tags with content before name/property", () => {
    const html = '<meta content="2025-09-09" name="citation_date"><title>Reversed</title>';
    const meta = extractMetadata(html, "https://x.com/p");
    expect(meta.title).toBe("Reversed");
    expect(meta.year).toBe(2025);
  });
});
