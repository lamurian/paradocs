/**
 * URL canonicalization and registrable-domain extraction.
 *
 * Deterministic, LLM-free helpers extracted from the former research
 * engine's fetcher module so other extensions can share them.
 *
 * @module common/url
 */

// ── Canonicalization ──────────────────────────────────────────────────

/** Tracking query params stripped during canonicalization. */
const TRACKING_PARAMS =
  /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|igshid|si|ref_src|ref_url|yclid)$/i;

/**
 * Canonicalize a URL for dedupe: strip tracking params, the fragment,
 * trailing slashes, and arXiv version suffixes.
 *
 * @param url - Raw URL.
 * @returns Canonical form; the trimmed input when unparseable.
 */
export function canonicalizeUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    let out = u.toString();
    if (out.endsWith("/") && u.pathname !== "/") out = out.slice(0, -1);
    else if (out.endsWith("/") && u.pathname === "/" && u.search === "") out = out.slice(0, -1);
    out = out.replace(
      /^https?:\/\/(?:www\.)?(arxiv\.org\/(?:abs|pdf)\/\d{4}\.\d{4,5})v\d+(?:\?.*)?$/i,
      "https://$1",
    );
    return out;
  } catch {
    return trimmed;
  }
}

// ── Domain extraction ─────────────────────────────────────────────────

/** Second-level registry suffixes needing three labels for eTLD+1. */
const SECOND_LEVEL_SUFFIXES = new Set([
  "co.uk",
  "ac.uk",
  "gov.uk",
  "org.uk",
  "me.uk",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "co.nz",
  "net.nz",
  "org.nz",
  "gov.nz",
  "co.jp",
  "ne.jp",
  "or.jp",
  "ac.jp",
  "go.jp",
  "co.in",
  "ac.in",
  "gov.in",
  "net.in",
  "org.in",
  "com.br",
  "net.br",
  "org.br",
  "gov.br",
  "com.sg",
  "com.tw",
  "org.tw",
  "gov.tw",
  "co.kr",
  "or.kr",
  "ac.kr",
  "go.kr",
  "com.hk",
  "org.hk",
  "gov.hk",
  "edu.hk",
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "edu.cn",
  "com.mx",
  "com.ar",
  "com.tr",
  "co.za",
  "com.my",
  "co.id",
  "or.id",
  "web.id",
  "ac.id",
  "go.id",
]);

/**
 * Extract the registrable domain (lightweight eTLD+1) from a URL.
 *
 * @param url - URL to inspect.
 * @returns Lowercased registrable domain, or "" when unparseable.
 */
export function registrableDomain(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const parts = host.split(".").filter(Boolean);
    if (parts.length <= 2) return parts.join(".");
    const lastTwo = parts.slice(-2).join(".");
    if (SECOND_LEVEL_SUFFIXES.has(lastTwo)) return parts.slice(-3).join(".");
    return lastTwo;
  } catch {
    return "";
  }
}
