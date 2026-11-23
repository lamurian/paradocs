/**
 * Tests for common/fetch-quality.ts — junk-page detection.
 */

import { describe, it, expect } from "vitest";

import { detectJunkPage } from "../../common/fetch-quality.ts";

describe("detectJunkPage", () => {
  it("detects captcha interstitials", () => {
    expect(detectJunkPage("Checking your browser - reCAPTCHA", "")).toBe("captcha");
  });

  it("detects captcha markers in content", () => {
    expect(detectJunkPage("Example", "Please verify you are human before continuing.")).toBe(
      "captcha",
    );
  });

  it("detects redirect stubs by title", () => {
    expect(detectJunkPage("Redirecting", "")).toBe("redirect-stub");
  });

  it("detects redirect stubs by short content", () => {
    expect(detectJunkPage("Example", "You are being redirect to the new page.")).toBe(
      "redirect-stub",
    );
  });

  it("returns null for a normal documentation page", () => {
    const content =
      "# Documentation\n\n" +
      "This guide explains how to install the package, configure it, and run the " +
      "test suite. It covers common pitfalls and troubleshooting steps in detail.";
    expect(detectJunkPage("Documentation", content)).toBeNull();
  });

  it("only applies the too-short check when minChars is given", () => {
    const content = "Short but legitimate.";
    expect(detectJunkPage("Tiny", content)).toBeNull();
    expect(detectJunkPage("Tiny", content, { minChars: 1000 })).toBe("too-short");
    expect(detectJunkPage("Tiny", content, { minChars: 5 })).toBeNull();
  });

  it("counts collapsed content length for the too-short check", () => {
    const content = `   ${"word ".repeat(20)}   `;
    expect(detectJunkPage("Tiny", content, { minChars: 200 })).toBe("too-short");
    expect(detectJunkPage("Tiny", content, { minChars: 50 })).toBeNull();
  });
});
