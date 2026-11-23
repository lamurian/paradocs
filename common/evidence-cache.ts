/**
 * Evidence pack cache.
 *
 * Stores deterministic evidence packs under
 * `<cwd>/.pi/paradocs/evidence/<id>.json`, so later tool calls can read a
 * gathered pack without repeating network work. No network access and no
 * LLM calls happen here.
 *
 * @module common/evidence-cache
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { TrustClass } from "./trust.ts";

/** Maximum characters of source content kept per source. */
export const MAX_SOURCE_CONTENT_CHARS = 50_000;

/** One external source captured while gathering evidence. */
export interface EvidenceSource {
  url: string;
  canonicalUrl: string;
  title: string;
  trust: TrustClass;
  tier: number | null;
  query: string;
  excerpt: string;
  content?: string;
  fetchError?: string;
  relevance?: number;
}

/** One query executed while gathering evidence, with its KB coverage. */
export interface EvidencePackQuery {
  query: string;
  kbCovered: boolean;
  since: string | null;
  kbHits: Array<{
    path: string;
    title: string;
    freshness: string;
    relevance?: number;
    relevant?: boolean;
  }>;
}

/** A complete evidence pack as stored on disk. */
export interface EvidencePack {
  id: string;
  question: string;
  createdAt: string;
  queries: EvidencePackQuery[];
  sources: EvidenceSource[];
  rejected?: Array<{ url: string; reason: string }>;
}

/**
 * Resolve the evidence cache directory for a working directory.
 *
 * @param cwd - Project working directory.
 * @returns Absolute path to `<cwd>/.pi/paradocs/evidence`.
 */
function evidenceDir(cwd: string): string {
  return join(cwd, ".pi", "paradocs", "evidence");
}

/**
 * Generate a fresh evidence pack id.
 *
 * @returns Id of the form `ev-<time base36>-<4 random hex chars>`.
 */
function createEvidenceId(): string {
  return `ev-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
}

/**
 * Cap optional source content at the cache limit.
 *
 * @param source - Source to normalize.
 * @returns A source copy whose content is at most 50000 characters.
 */
function capSourceContent(source: EvidenceSource): EvidenceSource {
  if (source.content === undefined) return source;
  if (source.content.length <= MAX_SOURCE_CONTENT_CHARS) return source;
  return { ...source, content: source.content.slice(0, MAX_SOURCE_CONTENT_CHARS) };
}

/**
 * Write an evidence pack to the cwd cache.
 *
 * The generated id is added to the returned pack and used as the file name.
 * Source content longer than 50000 characters is truncated.
 *
 * @param cwd - Project working directory that owns the cache.
 * @param pack - Pack contents without an id.
 * @returns The stored pack, including its generated id.
 */
export function saveEvidencePack(cwd: string, pack: Omit<EvidencePack, "id">): EvidencePack {
  const id = createEvidenceId();
  const stored: EvidencePack = {
    id,
    question: pack.question,
    createdAt: pack.createdAt,
    queries: pack.queries,
    sources: pack.sources.map(capSourceContent),
    ...(pack.rejected === undefined ? {} : { rejected: pack.rejected }),
  };

  const dir = evidenceDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  return stored;
}

/**
 * Read a previously stored evidence pack.
 *
 * @param cwd - Project working directory that owns the cache.
 * @param id - Evidence pack id, e.g. `ev-abc123-1a2b`.
 * @returns The stored pack, or null when the file is missing or unreadable.
 */
export function loadEvidencePack(cwd: string, id: string): EvidencePack | null {
  try {
    const raw = readFileSync(join(evidenceDir(cwd), `${id}.json`), "utf8");
    return JSON.parse(raw) as EvidencePack;
  } catch {
    return null;
  }
}
