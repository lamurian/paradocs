/**
 * Tests for registrable-domain extraction (lightweight eTLD+1).
 *
 * @module tests/research-engine/domain.test
 */

import { describe, it, expect } from "vitest";

import { registrableDomain } from "../../extensions/research-engine/fetcher.js";

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
