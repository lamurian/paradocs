/**
 * Tests for common/trust.ts — deterministic trust classification.
 *
 * @module tests/common/trust
 */

import { describe, it, expect } from "vitest";

import { classifyTrust } from "../../common/trust.ts";

describe("classifyTrust", () => {
  it("should classify DOI signals as peer-reviewed", () => {
    expect(classifyTrust("https://example.org/article", { doi: "10.1000/xyz" })).toBe(
      "peer-reviewed",
    );
    expect(classifyTrust("https://doi.org/10.1000/xyz", { doi: "10.1000/xyz" })).toBe(
      "peer-reviewed",
    );
  });

  it("should classify URL DOIs by registrant prefix", () => {
    expect(classifyTrust("https://doi.org/10.1038/nature123")).toBe("peer-reviewed");
    expect(classifyTrust("https://dx.doi.org/10.1145/1234")).toBe("peer-reviewed");
    expect(classifyTrust("https://example.org/doi/10.1126/science.1")).toBe("peer-reviewed");
    expect(classifyTrust("https://doi.org/10.2139/ssrn.123")).toBe("preprint");
    expect(classifyTrust("https://doi.org/10.1101/2020.01.01")).toBe("preprint");
    expect(classifyTrust("https://doi.org/10.5089/imf.123")).toBe("reference");
    expect(classifyTrust("https://doi.org/10.1000/xyz")).toBe("reference");
  });

  it("should treat null DOI option as no signal", () => {
    expect(classifyTrust("https://example.org/article", { doi: null })).toBe("unknown");
  });

  it("should classify preprint servers as preprint", () => {
    for (const url of [
      "https://arxiv.org/abs/1234.5678",
      "https://www.biorxiv.org/content/10.1101/123",
      "https://www.medrxiv.org/content/10.1101/456",
      "https://ssrn.com/abstract=1",
      "https://osf.io/preprints/abc",
      "https://www.preprints.org/manuscript/1",
      "https://www.researchsquare.com/article/1",
    ]) {
      expect(classifyTrust(url)).toBe("preprint");
    }
  });

  it("should classify journal and publisher hosts as peer-reviewed", () => {
    for (const url of [
      "https://www.nature.com/articles/1",
      "https://www.science.org/doi/10.1126/science.1",
      "https://www.sciencedirect.com/science/article/1",
      "https://link.springer.com/article/1",
      "https://onlinelibrary.wiley.com/doi/1",
      "https://www.tandfonline.com/doi/1",
      "https://journals.sagepub.com/doi/1",
      "https://jamanetwork.com/journals/jama/article-1",
      "https://www.thelancet.com/journals/lancet/article/1",
      "https://www.nejm.org/doi/1",
      "https://www.bmj.com/content/1",
      "https://journals.plos.org/plosone/article?id=1",
      "https://www.frontiersin.org/articles/1",
      "https://www.mdpi.com/1234",
      "https://dl.acm.org/doi/10.1145/1",
      "https://ieeexplore.ieee.org/document/1",
      "https://www.ncbi.nlm.nih.gov/pmc/articles/1",
      "https://academic.oup.com/nar/article/1",
      "https://www.cambridge.org/core/journals/1",
    ]) {
      expect(classifyTrust(url)).toBe("peer-reviewed");
    }
  });

  it("should classify government, military and academic hosts as gov-edu", () => {
    for (const url of [
      "https://example.edu/research",
      "https://www.example.edu/research",
      "https://www.nasa.gov/report",
      "https://www.defense.mil/report",
      "https://www.ox.ac.uk/paper",
      "https://www.eth.edu.au/paper",
      "https://www.example.gov.uk/report",
      "https://www.example.go.jp/report",
    ]) {
      expect(classifyTrust(url)).toBe("gov-edu");
    }
  });

  it("should classify documentation hosts as official-docs", () => {
    for (const url of [
      "https://docs.example.com/guide",
      "https://developer.example.com/api",
      "https://developers.example.com/api",
      "https://example.readthedocs.io/en/latest/",
      "https://developer.mozilla.org/en-US/docs/Web/API",
      "https://learn.microsoft.com/en-us/dotnet/",
      "https://example.com/docs/getting-started",
    ]) {
      expect(classifyTrust(url)).toBe("official-docs");
    }
  });

  it("should classify reference works as reference", () => {
    expect(classifyTrust("https://en.wikipedia.org/wiki/PARA")).toBe("reference");
    expect(classifyTrust("https://www.britannica.com/topic/para")).toBe("reference");
  });

  it("should classify blogs and forums as blog-forum", () => {
    for (const url of [
      "https://medium.com/@someone/post",
      "https://someone.substack.com/p/post",
      "https://www.reddit.com/r/typescript",
      "https://stackoverflow.com/questions/1",
      "https://english.stackexchange.com/questions/1",
      "https://dev.to/someone/post",
      "https://someone.hashnode.dev/post",
      "https://someone.blogspot.com/post",
      "https://someone.wordpress.com/post",
      "https://www.quora.com/question",
      "https://news.ycombinator.com/item?id=1",
      "https://example.com/blog/my-post",
    ]) {
      expect(classifyTrust(url)).toBe("blog-forum");
    }
  });

  it("should fall back to unknown", () => {
    expect(classifyTrust("https://example.com/article")).toBe("unknown");
    expect(classifyTrust("not a url")).toBe("unknown");
  });

  it("should apply rules in order: journals before suffixes and docs", () => {
    expect(classifyTrust("https://www.nature.com/articles/1", { doi: "10.1/x" })).toBe(
      "peer-reviewed",
    );
  });
});
