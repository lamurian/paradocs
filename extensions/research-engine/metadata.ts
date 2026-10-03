/**
 * Deterministic page-metadata extraction (no LLM).
 *
 * Priority: citation/DC meta tags → JSON-LD datePublished → arXiv ID.
 *
 * @module extensions/research-engine/metadata
 */

/** Deterministically extracted page metadata. */
export interface PageMetadata {
  title?: string;
  authors?: string[];
  year?: number;
  month?: number;
}

function matchMeta(content: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:name|property|itemprop)=["']${key}["'][^>]*content=["']([^"']+)["']`,
      "i",
    );
    const m = content.match(re);
    if (m?.[1]) return m[1].trim();
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property|itemprop)=["']${key}["']`,
      "i",
    );
    const m2 = content.match(re2);
    if (m2?.[1]) return m2[1].trim();
  }
  return undefined;
}

function matchMetaAll(content: string, keys: string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${key}["'][^>]*content=["']([^"']+)["']`,
      "gi",
    );
    for (const m of content.matchAll(re)) {
      if (m[1]) out.push(m[1].trim());
    }
  }
  return out;
}

function yearFrom(value: string | undefined): { year?: number; month?: number } {
  if (!value) return {};
  const iso = value.match(/(\d{4})-(\d{2})/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]) };
  const y = value.match(/\b(19|20)\d{2}\b/);
  return y ? { year: Number(y[0]) } : {};
}

/**
 * Extract citation metadata deterministically from page content.
 *
 * @param content - Extracted page text/markdown (HTML remnants included).
 * @param url - Source URL (used for arXiv ID dates).
 * @returns Metadata found; fields are undefined when not derivable.
 */
export function extractMetadata(content: string, url: string): PageMetadata {
  const title =
    matchMeta(content, ["citation_title", "og:title", "twitter:title"]) ??
    content.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1]?.trim();

  const authors = matchMetaAll(content, ["citation_author", "author", "DC.creator"]);
  const dateRaw =
    matchMeta(content, ["citation_date", "article:published_time", "DC.date", "pubdate"]) ??
    content.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1];

  let dated = yearFrom(dateRaw);
  if (dated.year === undefined) {
    const arxiv = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{2})(\d{2})\./i);
    if (arxiv) dated = { year: 2000 + Number(arxiv[1]), month: Number(arxiv[2]) };
  }

  return {
    title,
    authors: authors.length > 0 ? authors : undefined,
    year: dated.year,
    month: dated.month,
  };
}
