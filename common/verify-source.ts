/**
 * Deterministic source verification.
 *
 * Resolves a DOI through Crossref, checks URL reachability with a HEAD
 * request (falling back to GET on 405), looks up the closest Wayback
 * snapshot, and classifies trust. Every check is independent: a failure
 * marks that check `unknown`, nulls its fields, and never throws.
 *
 * @module common/verify-source
 */

import { classifyTrust } from "./trust.ts";
import { canonicalizeUrl } from "./url.ts";

import type { TrustClass } from "./trust.ts";

/** Per-check status; `unknown` means the check failed or was not run. */
export type VerifyCheckStatus = "ok" | "unknown";

/** Names of the individual checks reported by {@link verifySource}. */
export type VerifyCheckName = "reachability" | "crossref" | "wayback";

/** Input to {@link verifySource}. */
export interface VerifySourceInput {
  url?: string;
  doi?: string;
}

/** Injected dependencies, kept explicit for deterministic testing. */
export interface VerifySourceDeps {
  fetch: typeof fetch;
  now: () => Date;
}

/** Aggregated verification result. */
export interface VerifySourceResult {
  canonicalUrl: string | null;
  reachable: boolean | null;
  httpStatus: number | null;
  doi: string | null;
  title: string | null;
  published: string | null;
  container: string | null;
  retracted: boolean | null;
  trust: TrustClass;
  waybackUrl: string | null;
  checks: Record<VerifyCheckName, VerifyCheckStatus>;
}

/** DOI pattern used when only a URL is supplied. */
const DOI_PATTERN = /10\.\d{4,9}\/[^\s?#]+/;

/** Timeout applied to every outgoing request. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Crossref work message fields used here. */
interface CrossrefMessage {
  title?: unknown;
  "container-title"?: unknown;
  issued?: { "date-parts"?: unknown };
  "updated-by"?: unknown;
}

/** Minimal Wayback availability response shape. */
interface WaybackResponse {
  archived_snapshots?: { closest?: { url?: unknown } };
}

/**
 * Pick the first string from an unknown value (string or string array).
 *
 * @param value - Candidate value from an API payload.
 * @returns The first non-empty string, else null.
 */
function firstString(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry.length > 0) return entry;
    }
  }
  return null;
}

/**
 * Extract a DOI from a raw DOI string, stripping resolver prefixes.
 *
 * @param value - DOI as given by the caller.
 * @returns The bare DOI, or null when it does not look like a DOI.
 */
function normalizeDoi(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value
    .trim()
    .replace(/^doi:/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  const match = trimmed.match(DOI_PATTERN);
  return match ? match[0] : null;
}

/**
 * Resolve the DOI for the input: explicit doi first, then URL extraction.
 *
 * @param input - Verification input.
 * @returns The bare DOI or null.
 */
function resolveDoi(input: VerifySourceInput): string | null {
  if (input.doi) {
    const explicit = normalizeDoi(input.doi);
    if (explicit) return explicit;
  }
  if (!input.url) return null;
  const match = input.url.match(DOI_PATTERN);
  return match ? match[0] : null;
}

/**
 * Format Crossref date-parts as `YYYY`, `YYYY-MM` or `YYYY-MM-DD`.
 *
 * @param value - `issued["date-parts"]` value from Crossref.
 * @returns The formatted date, or null when unusable.
 */
function formatPublished(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parts: unknown = value[0];
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const year = Number(parts[0]);
  if (!Number.isFinite(year)) return null;
  const pad = (n: unknown): string => String(Number(n)).padStart(2, "0");
  if (parts.length === 1) return String(year);
  if (parts.length === 2) return `${year}-${pad(parts[1])}`;
  return `${year}-${pad(parts[1])}-${pad(parts[2])}`;
}

/**
 * Detect a retraction entry in Crossref `updated-by`.
 *
 * @param value - `updated-by` value from Crossref.
 * @returns True when any entry has type `retraction`.
 */
function detectRetraction(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    return (entry as { type?: unknown }).type === "retraction";
  });
}

/**
 * Fetch JSON with the shared request timeout, returning null on failure.
 *
 * @param deps - Injected fetch and clock.
 * @param url - Absolute URL to request.
 * @returns Parsed JSON or null.
 */
async function fetchJson<T>(deps: VerifySourceDeps, url: string): Promise<T | null> {
  const response = await deps.fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

/**
 * Populate Crossref fields on the result. Mutates and returns the result.
 *
 * @param deps - Injected fetch and clock.
 * @param doi - Bare DOI to look up.
 * @param result - Result being built.
 * @returns The same result instance.
 */
async function applyCrossref(
  deps: VerifySourceDeps,
  doi: string,
  result: VerifySourceResult,
): Promise<VerifySourceResult> {
  try {
    const payload = await fetchJson<{ message?: CrossrefMessage }>(
      deps,
      `https://api.crossref.org/works/${doi}`,
    );
    const message = payload?.message;
    if (!message) return result;

    result.title = firstString(message.title);
    result.container = firstString(message["container-title"]);
    result.published = formatPublished(message.issued?.["date-parts"]);
    result.retracted = detectRetraction(message["updated-by"]);
    result.checks.crossref = "ok";
  } catch {
    // Leave crossref unknown with null fields.
  }
  return result;
}

/**
 * Perform the reachability check (HEAD, retrying GET on 405).
 *
 * @param deps - Injected fetch and clock.
 * @param url - URL to check.
 * @param result - Result being built.
 * @returns The same result instance.
 */
async function applyReachability(
  deps: VerifySourceDeps,
  url: string,
  result: VerifySourceResult,
): Promise<VerifySourceResult> {
  try {
    const init = {
      method: "HEAD",
      redirect: "follow" as RequestRedirect,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    let response = await deps.fetch(url, init);
    if (response.status === 405) {
      response = await deps.fetch(url, {
        ...init,
        method: "GET",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    }

    result.httpStatus = response.status;
    result.reachable = response.status >= 200 && result.httpStatus < 400;
    result.canonicalUrl = canonicalizeUrl(response.url || url);
    result.checks.reachability = "ok";
  } catch {
    // Leave reachability unknown with null fields.
  }
  return result;
}

/**
 * Look up the closest Wayback snapshot for a URL.
 *
 * @param deps - Injected fetch and clock.
 * @param url - URL to look up.
 * @param result - Result being built.
 * @returns The same result instance.
 */
async function applyWayback(
  deps: VerifySourceDeps,
  url: string,
  result: VerifySourceResult,
): Promise<VerifySourceResult> {
  try {
    const payload = await fetchJson<WaybackResponse>(
      deps,
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
    );
    if (!payload) return result;
    const closest = payload.archived_snapshots?.closest;
    result.waybackUrl = firstString(closest?.url);
    result.checks.wayback = "ok";
  } catch {
    // Leave wayback unknown with a null URL.
  }
  return result;
}

/**
 * Verify a source by DOI and/or URL.
 *
 * Runs Crossref, reachability and Wayback checks independently. A failing
 * check yields `unknown` with null fields; the function never throws.
 *
 * @param input - URL and/or DOI to verify.
 * @param deps - Injected fetch and clock.
 * @returns The aggregated verification result.
 */
export async function verifySource(
  input: VerifySourceInput,
  deps: VerifySourceDeps,
): Promise<VerifySourceResult> {
  const doi = resolveDoi(input);
  const url = input.url?.trim() || null;

  const result: VerifySourceResult = {
    canonicalUrl: null,
    reachable: null,
    httpStatus: null,
    doi,
    title: null,
    published: null,
    container: null,
    retracted: null,
    trust: classifyTrust(url ?? `https://doi.org/${doi ?? ""}`, { doi }),
    waybackUrl: null,
    checks: { reachability: "unknown", crossref: "unknown", wayback: "unknown" },
  };

  if (doi) await applyCrossref(deps, doi, result);
  if (url) {
    await applyReachability(deps, url, result);
    await applyWayback(deps, url, result);
  }

  return result;
}
