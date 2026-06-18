/**
 * Plain-HTTP fallback for link-summarizer.
 * Used when Obscura headless browser is not available.
 */

const MAX_HTTP_BODY_BYTES = 8_000_000;
const PDF_CT_RE = /^application\/pdf/i;

export function extractReadableText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";

  let cleaned = html.replace(
    /<(script|style|svg|nav|header|footer|noscript|iframe)[^>]*>[\s\S]*?<\/\1>/gi,
    "",
  );
  cleaned = cleaned.replace(/<[^>]*>/g, " ");
  cleaned = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#\d+;/g, " ")
    .replace(/&[a-z]+;/g, " ");
  cleaned = cleaned
    .replace(/[\r\n]+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, text: cleaned };
}

export async function fetchViaHttp(
  url: string,
  signal?: AbortSignal,
): Promise<{ title: string; text: string } | { error: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PiSummarizer/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
  } catch (err: unknown) {
    return { error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!response.ok) return { error: `HTTP ${response.status} ${response.statusText}` };

  const contentType = response.headers.get("content-type") ?? "";
  if (PDF_CT_RE.test(contentType)) return { error: "PDF_CONTENT_TYPE" };

  const reader = response.body?.getReader();
  if (!reader) return { error: "No response body" };

  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalSize += value.length;
      if (totalSize > MAX_HTTP_BODY_BYTES) {
        reader.cancel();
        break;
      }
    }
  } catch (err: unknown) {
    return { error: `Error reading body: ${err instanceof Error ? err.message : String(err)}` };
  }

  const html = new TextDecoder().decode(
    chunks.reduce((acc, c) => {
      const merged = new Uint8Array(acc.length + c.length);
      merged.set(acc);
      merged.set(c, acc.length);
      return merged;
    }, new Uint8Array(0)),
  );

  const { title, text } = extractReadableText(html);
  if (!text.trim()) {
    return { error: "No readable text extracted. The page may require JavaScript." };
  }
  return { title, text };
}
