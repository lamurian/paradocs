/**
 * Tests for common/url canonicalization and registrable-domain extraction.
 *
 * Ported from the former research-engine fetcher and domain tests.
 *
 * @module tests/common/url.test
 */

import { describe, it, expect } from "vitest";

import { canonicalizeUrl, registrableDomain } from "../../common/url.ts";

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
