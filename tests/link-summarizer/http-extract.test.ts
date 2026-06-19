import { describe, it, expect } from "vitest";

describe("extractReadableText", () => {
  it("should extract title and text from simple HTML", async () => {
    const { extractReadableText } = await import("../../extensions/link-summarizer/http.js");
    const result = extractReadableText(
      "<html><head><title>Test Page</title></head><body><p>Hello world</p></body></html>",
    );
    expect(result.title).toBe("Test Page");
    expect(result.text).toContain("Hello world");
  });

  it("should strip script and style tags", async () => {
    const { extractReadableText } = await import("../../extensions/link-summarizer/http.js");
    const html = `<html><head><title>Page</title></head><body>
      <script>alert('xss')</script>
      <style>.hidden{display:none}</style>
      <p>Visible content</p>
    </body></html>`;
    const result = extractReadableText(html);
    expect(result.title).toBe("Page");
    expect(result.text).toContain("Visible content");
    expect(result.text).not.toContain("alert");
    expect(result.text).not.toContain("hidden");
  });

  it("should strip nav, header, footer, noscript, iframe tags", async () => {
    const { extractReadableText } = await import("../../extensions/link-summarizer/http.js");
    const html = `<html><body>
      <nav>Navigation</nav>
      <header>Header</header>
      <footer>Footer</footer>
      <noscript>JS required</noscript>
      <iframe src="ads.html"></iframe>
      <main>Main content</main>
    </body></html>`;
    const result = extractReadableText(html);
    expect(result.text).toContain("Main content");
    expect(result.text).not.toContain("Navigation");
    expect(result.text).not.toContain("Header");
    expect(result.text).not.toContain("Footer");
    expect(result.text).not.toContain("JS required");
  });

  it("should decode HTML entities", async () => {
    const { extractReadableText } = await import("../../extensions/link-summarizer/http.js");
    const html = `<html><head><title>Foo &amp; Bar</title></head><body>
      <p>price &lt; 10 &gt; 5 &quot;quote&quot; &#x27;apos&#x2F;slash&#x27;</p>
    </body></html>`;
    const result = extractReadableText(html);
    expect(result.text).toContain("&");
    expect(result.text).toContain("<");
    expect(result.text).toContain('"');
    expect(result.text).toContain("'");
  });

  it("should return empty title when no title tag", async () => {
    const { extractReadableText } = await import("../../extensions/link-summarizer/http.js");
    const result = extractReadableText("<html><body><p>No title</p></body></html>");
    expect(result.title).toBe("");
  });

  it("should handle empty HTML", async () => {
    const { extractReadableText } = await import("../../extensions/link-summarizer/http.js");
    const result = extractReadableText("");
    expect(result.title).toBe("");
    expect(result.text).toBe("");
  });

  it("should normalise whitespace and trim", async () => {
    const { extractReadableText } = await import("../../extensions/link-summarizer/http.js");
    const html = "<html><body><p>  lots  of   spaces </p><p>\n\nnewlines\n\n</p></body></html>";
    const result = extractReadableText(html);
    expect(result.text).toContain("lots of spaces");
    expect(result.text).toContain("newlines");
    expect(result.text).not.toMatch(/^ /);
    expect(result.text).not.toMatch(/ $/);
  });
});
