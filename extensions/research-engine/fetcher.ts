/**
 * Deterministic fetch-side utilities: URL canonicalization, domain
 * extraction, metadata parsing, boilerplate stripping, and the parallel
 * fetch runner. No LLM involvement — everything here is pure code.
 *
 * @module extensions/research-engine/fetcher
 */

import { extractMetadata } from "./metadata.js";

import type { FetchRecord } from "./state.js";

export { extractMetadata } from "./metadata.js";
export type { PageMetadata } from "./metadata.js";

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

/** Hostnames/suffixes treated as authoritative (tier-1/2) sources. */
const AUTHORITATIVE_HOSTS = [
  ".edu",
  ".gov",
  ".mil",
  ".ac.uk",
  ".ac.nz",
  ".ac.jp",
  ".ac.kr",
  ".ac.in",
  "arxiv.org",
  "doi.org",
  "ssrn.com",
  "nber.org",
  "acm.org",
  "ieee.org",
  "pubmed.ncbi.nlm.nih.gov",
  "nature.com",
  "science.org",
  "plos.org",
  "springer.com",
  "wiley.com",
  "jstor.org",
  "bmj.com",
  "thelancet.com",
];

/**
 * Whether a source counts as authoritative for the AUTHORITY gate.
 *
 * Tier 1/2 search results always count; otherwise a domain heuristic
 * applies (academic/gov hosts and major publishers).
 *
 * @param url - Source URL.
 * @param tier - Search tier that produced the source, when known.
 * @returns True when the source is authoritative.
 */
export function isAuthoritative(url: string, tier?: number): boolean {
  if (tier === 1 || tier === 2) return true;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return AUTHORITATIVE_HOSTS.some((h) => host === h || host.endsWith(h));
  } catch {
    return false;
  }
}

// ── Boilerplate stripping ─────────────────────────────────────────────

const NAV_LINE =
  /^(menu|search|sign in|log in|subscribe|cookie(s)? notice|skip to content|back to top|share this|follow us)[.!]?$/i;

/**
 * Deterministically strip boilerplate from extracted page text.
 *
 * Removes markdown images, nav-style lines, and collapses blank runs.
 *
 * @param text - Raw extracted text.
 * @returns Cleaned text.
 */
export function stripBoilerplate(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .split("\n")
    .filter((line) => !NAV_LINE.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Parallel fetch runner ─────────────────────────────────────────────

/** Injected per-URL fetch function. */
export type FetchFn = (
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<{ title?: string; content?: string; error?: string }>;

/**
 * Fetch a list of URLs with bounded concurrency, recording deterministic
 * metadata per record and typed errors on failure.
 *
 * @param urls - URLs to fetch.
 * @param opts - Concurrency, timeout, per-candidate tier map, clock, signal.
 * @returns Fetch records in input order.
 */
export async function fetchRecords(
  urls: string[],
  opts: {
    fetchFn: FetchFn;
    concurrency?: number;
    timeoutMs?: number;
    tiers?: Map<string, number>;
    now?: () => number;
    signal?: AbortSignal;
  },
): Promise<FetchRecord[]> {
  const now = opts.now ?? Date.now;
  const limit = Math.max(1, opts.concurrency ?? 4);
  const results = new Array<FetchRecord>(urls.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= urls.length) return;
      const url = urls[i];
      const canonicalUrl = canonicalizeUrl(url);
      const startedAt = now();
      let record: FetchRecord;
      try {
        const res = await opts.fetchFn(url, opts.timeoutMs ?? 20_000, opts.signal);
        const durationMs = now() - startedAt;
        if (res.error !== undefined || res.content === undefined) {
          record = {
            url,
            canonicalUrl,
            ok: false,
            error: res.error ?? "empty content",
            tier: opts.tiers?.get(canonicalUrl),
            fetchedAt: startedAt,
            durationMs,
          };
        } else {
          const meta = extractMetadata(res.content, url);
          record = {
            url,
            canonicalUrl,
            ok: true,
            content: res.content,
            title: meta.title ?? res.title,
            authors: meta.authors,
            year: meta.year,
            tier: opts.tiers?.get(canonicalUrl),
            fetchedAt: startedAt,
            durationMs,
          };
        }
      } catch (e: unknown) {
        record = {
          url,
          canonicalUrl,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          tier: opts.tiers?.get(canonicalUrl),
          fetchedAt: startedAt,
          durationMs: now() - startedAt,
        };
      }
      results[i] = record;
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, worker));
  return results;
}
