/**
 * Deterministic source trust classification.
 *
 * Classifies a URL into a coarse trust class using only its host and path
 * (plus an optional DOI signal). No network access, no LLM calls.
 *
 * @module common/trust
 */

/** Coarse trust class for a search result or citation source. */
export type TrustClass =
  | "peer-reviewed"
  | "preprint"
  | "gov-edu"
  | "official-docs"
  | "reference"
  | "blog-forum"
  | "unknown";

/** Hosts that serve preprint manuscripts. */
const PREPRINT_HOSTS = [
  "arxiv.org",
  "biorxiv.org",
  "medrxiv.org",
  "ssrn.com",
  "osf.io",
  "preprints.org",
  "researchsquare.com",
];

/** Hosts of peer-reviewed journals, publishers and indexes. */
const PEER_REVIEWED_HOSTS = [
  "nature.com",
  "science.org",
  "sciencedirect.com",
  "springer.com",
  "wiley.com",
  "tandfonline.com",
  "sagepub.com",
  "jamanetwork.com",
  "thelancet.com",
  "nejm.org",
  "bmj.com",
  "plos.org",
  "frontiersin.org",
  "mdpi.com",
  "acm.org",
  "ieeexplore.ieee.org",
  "ncbi.nlm.nih.gov",
  "academic.oup.com",
  "cambridge.org",
];

/** Hosts of curated reference works. */
const REFERENCE_HOSTS = ["wikipedia.org", "britannica.com"];

/** Hosts of blogs, forums and community Q&A sites. */
const BLOG_FORUM_HOSTS = [
  "medium.com",
  "substack.com",
  "reddit.com",
  "stackoverflow.com",
  "stackexchange.com",
  "dev.to",
  "hashnode.dev",
  "blogspot.com",
  "wordpress.com",
  "quora.com",
  "news.ycombinator.com",
];

/** Second-level suffixes treated as government, military or academic. */
const GOV_EDU_SUFFIXES = [".edu", ".gov", ".mil"];

/** Country-code government/academic suffixes, e.g. `.ac.uk`, `.go.jp`. */
const GOV_EDU_CC_PATTERN = /\.(?:ac|edu|gov|go)\.[a-z]{2}$/;

/**
 * Normalize a hostname: lowercase and strip a leading `www.`.
 *
 * @param hostname - Raw hostname from the URL parser.
 * @returns Lowercase host without `www.`.
 */
function normalizeHost(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

/**
 * Test whether a host equals a domain or is a subdomain of it.
 *
 * @param host - Normalized hostname.
 * @param domain - Domain to match against.
 * @returns True when equal or `host` ends with `.${domain}`.
 */
function matchesHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Parse a URL, returning null when it cannot be parsed.
 *
 * @param url - Raw URL string.
 * @returns Parsed URL or null.
 */
function safeParse(url: string): URL | null {
  try {
    return new URL(url.trim());
  } catch {
    return null;
  }
}

/**
 * Check whether the host is a docs/developer host.
 *
 * @param host - Normalized hostname.
 * @returns True for docs subdomains and known developer doc sites.
 */
function isDocsHost(host: string): boolean {
  return (
    host.startsWith("docs.") ||
    host.startsWith("developer.") ||
    host.startsWith("developers.") ||
    host.endsWith(".readthedocs.io") ||
    matchesHost(host, "developer.mozilla.org") ||
    matchesHost(host, "learn.microsoft.com")
  );
}

/**
 * Check whether the host carries a government, military or academic suffix.
 *
 * @param host - Normalized hostname.
 * @returns True for `.edu`/`.gov`/`.mil` and country-code academic suffixes.
 */
function isGovEduHost(host: string): boolean {
  return GOV_EDU_SUFFIXES.some((suffix) => host.endsWith(suffix)) || GOV_EDU_CC_PATTERN.test(host);
}

/** DOI registrant prefixes that identify preprint servers. */
const PREPRINT_DOI_PREFIXES = [
  "10.2139", // SSRN
  "10.48550", // arXiv
  "10.1101", // bioRxiv / medRxiv
  "10.31219", // OSF
  "10.31234", // OSF
  "10.31235", // OSF
  "10.21203", // Research Square
  "10.20944", // Preprints.org
];

/** DOI registrant prefixes that identify peer-reviewed publishers. */
const PEER_REVIEWED_DOI_PREFIXES = [
  "10.1038", // Nature
  "10.1126", // Science
  "10.1016", // Elsevier
  "10.1007", // Springer
  "10.1002", // Wiley
  "10.1111", // Wiley
  "10.1080", // Taylor & Francis
  "10.1177", // SAGE
  "10.1001", // JAMA
  "10.1056", // NEJM
  "10.1136", // BMJ
  "10.1371", // PLOS
  "10.3389", // Frontiers
  "10.3390", // MDPI
  "10.1145", // ACM
  "10.1109", // IEEE
  "10.1093", // OUP
  "10.1017", // Cambridge
];

/**
 * Extract the `10.NNNN` registrant prefix from a DOI string.
 *
 * @param doi - Raw DOI, optionally prefixed with a resolver URL.
 * @returns The prefix, or null when no DOI prefix can be found.
 */
function extractDoiPrefix(doi: string): string | null {
  const match = /(10\.\d+)\//.exec(doi);
  return match ? match[1] : null;
}

/**
 * Extract a DOI string from the URL host/path, when present.
 *
 * @param host - Normalized hostname.
 * @param path - Lowercase URL pathname.
 * @returns The DOI text, or null when the URL carries no DOI signal.
 */
function extractUrlDoi(host: string, path: string): string | null {
  if (matchesHost(host, "doi.org") || matchesHost(host, "dx.doi.org")) {
    return path.replace(/^\//, "");
  }
  if (path.includes("/doi/10.")) return path;
  return null;
}

/**
 * Classify a DOI prefix as a trust class.
 *
 * @param prefix - DOI registrant prefix such as `10.1038`.
 * @returns The matching trust class.
 */
function classifyDoiPrefix(prefix: string): TrustClass {
  if (PREPRINT_DOI_PREFIXES.includes(prefix)) return "preprint";
  if (PEER_REVIEWED_DOI_PREFIXES.includes(prefix)) return "peer-reviewed";
  return "reference";
}

/**
 * Check whether the host belongs to any of the given domains.
 *
 * @param host - Normalized hostname.
 * @param domains - Domains to test against.
 * @returns True when a domain matches.
 */
function matchesAnyHost(host: string, domains: string[]): boolean {
  return domains.some((domain) => matchesHost(host, domain));
}

/**
 * Check whether the host or path marks an official documentation source.
 *
 * @param host - Normalized hostname.
 * @param path - Lowercase URL pathname.
 * @returns True for docs hosts or paths under `/docs/`.
 */
function isOfficialDocs(host: string, path: string): boolean {
  return isDocsHost(host) || path.startsWith("/docs/");
}

/**
 * Check whether the host or path marks a blog or forum source.
 *
 * @param host - Normalized hostname.
 * @param path - Lowercase URL pathname.
 * @returns True for blog/forum hosts or paths containing `/blog/`.
 */
function isBlogForum(host: string, path: string): boolean {
  return matchesAnyHost(host, BLOG_FORUM_HOSTS) || path.includes("/blog/");
}

/**
 * Classify the trust level of a URL.
 *
 * Rules are applied in order: explicit DOI → preprint host → peer-reviewed
 * host → URL DOI prefix → gov/edu suffix → official docs → reference →
 * blog/forum → unknown. Host lists win over the DOI prefix rule.
 *
 * @param url - The URL to classify.
 * @param opts.doi - Optional DOI seen alongside the result.
 * @returns The matching trust class.
 */
export function classifyTrust(url: string, opts?: { doi?: string | null }): TrustClass {
  const parsed = safeParse(url);
  const host = parsed ? normalizeHost(parsed.hostname) : normalizeHost(url.trim().toLowerCase());
  const path = parsed ? parsed.pathname.toLowerCase() : "";

  // 1. Explicit DOI signals peer review.
  if (opts?.doi && opts.doi.trim().length > 0) return "peer-reviewed";

  // 2. Preprint servers (host lists win over DOI prefix).
  if (matchesAnyHost(host, PREPRINT_HOSTS)) return "preprint";

  // 3. Peer-reviewed journals and publishers (host lists win over DOI prefix).
  if (matchesAnyHost(host, PEER_REVIEWED_HOSTS)) return "peer-reviewed";

  // 4. URL DOI signals classified by registrant prefix.
  const urlDoi = extractUrlDoi(host, path);
  if (urlDoi) {
    const prefix = extractDoiPrefix(urlDoi);
    if (prefix) return classifyDoiPrefix(prefix);
  }

  // 5. Government, military and academic suffixes.
  if (isGovEduHost(host)) return "gov-edu";

  // 6. Official documentation.
  if (isOfficialDocs(host, path)) return "official-docs";

  // 7. Reference works.
  if (matchesAnyHost(host, REFERENCE_HOSTS)) return "reference";

  // 8. Blogs and forums.
  if (isBlogForum(host, path)) return "blog-forum";

  // 9. Unknown.
  return "unknown";
}
