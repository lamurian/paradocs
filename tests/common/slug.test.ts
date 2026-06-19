import { describe, it, expect } from "vitest";

describe("slugify", () => {
  it("should convert title to lowercase kebab-case", async () => {
    const { slugify } = await import("../../common/slug.js");
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("should replace special characters with hyphens", async () => {
    const { slugify } = await import("../../common/slug.js");
    expect(slugify("What is PARA? A Guide!")).toBe("what-is-para-a-guide");
  });

  it("should collapse multiple separators into one", async () => {
    const { slugify } = await import("../../common/slug.js");
    expect(slugify("Hello   World---Test")).toBe("hello-world-test");
  });

  it("should trim leading and trailing hyphens", async () => {
    const { slugify } = await import("../../common/slug.js");
    expect(slugify("--Hello World--")).toBe("hello-world");
  });

  it("should handle empty string", async () => {
    const { slugify } = await import("../../common/slug.js");
    expect(slugify("")).toBe("");
  });

  it("should handle single word", async () => {
    const { slugify } = await import("../../common/slug.js");
    expect(slugify("Hello")).toBe("hello");
  });

  it("should handle strings with numbers", async () => {
    const { slugify } = await import("../../common/slug.js");
    expect(slugify("ADR 001: Migration")).toBe("adr-001-migration");
  });
});
