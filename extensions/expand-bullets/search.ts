/**
 * Web search helper for expand-bullets.
 * Searches reputable web sources for each bullet point.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Search the web for a given query using DuckDuckGo HTML endpoints.
 * Returns up to 5 results from reputable domains.
 */
export async function searchWeb(pi: ExtensionAPI, query: string): Promise<WebResult[]> {
  const pyScript = `
import sys, json, urllib.request, urllib.parse, re, html as h

q = sys.argv[1]
url = "https://lite.duckduckgo.com/lite/?q=" + urllib.parse.quote(q)

req = urllib.request.Request(url, headers={
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
})
try:
    body = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", errors="replace")
    results = []
    for m in re.finditer(r'<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>\\s*(.*?)\\s*</a>', body, re.DOTALL):
        url = h.unescape(m.group(1)).strip()
        title = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        if title and url:
            results.append({"title": title, "url": url})

    if len(results) < 3:
        url2 = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(q)
        req2 = urllib.request.Request(url2, headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
        })
        body2 = urllib.request.urlopen(req2, timeout=15).read().decode("utf-8", errors="replace")
        seen = set(r["url"] for r in results)
        for m in re.finditer(r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', body2, re.DOTALL):
            url = h.unescape(m.group(1)).strip()
            title = re.sub(r"<[^>]+>", "", m.group(2)).strip()
            if title and url and url not in seen:
                seen.add(url)
                results.append({"title": title, "url": url})
        snippets = []
        for sm in re.finditer(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', body2, re.DOTALL):
            snippets.append(re.sub(r"<[^>]+>", "", sm.group(1)).strip())
        for i, s in enumerate(snippets):
            if i < len(results):
                results[i]["snippet"] = s

    pat = re.compile(r"\\.(edu|ac\\.[a-z]{2,}|gov\\.[a-z]{2,}|go\\.[a-z]{2,})", re.I)
    filtered = [r for r in results if pat.search(r["url"])]
    for r in (filtered if filtered else results[:5]):
        r.setdefault("snippet", "")
    print(json.dumps(filtered[:5] if filtered else results[:3]))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`.trim();

  try {
    const r = await pi.exec("python3", ["-c", pyScript, query], { timeout: 30_000 });
    if (r.code !== 0) return [];
    const data = JSON.parse(r.stdout);
    if (data.error) return [];
    return (data as Array<Record<string, string>>).map((d) => ({
      title: d.title ?? "Untitled",
      url: d.url ?? "",
      snippet: d.snippet ?? "",
    }));
  } catch {
    return [];
  }
}
