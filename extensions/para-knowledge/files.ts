/**
 * Filesystem scanning and file parsing.
 *
 * Walks the three PARA directories (Areas, Projects, Resources) to discover
 * markdown files and parse their frontmatter + body.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type FileEntry, type ParsedFile, PARA_DIRS } from "./types.js";
import { parseFrontmatter } from "./frontmatter.js";

/**
 * Walk one PARA directory and return all `.md` files with their mtimes.
 */
export async function scanParaDir(dir: string, base: string): Promise<FileEntry[]> {
  const abs = resolve(base, dir);
  let entries: string[];
  try {
    entries = await readdir(abs);
  } catch {
    return [];
  }

  const results: FileEntry[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const absPath = join(abs, name);
    const s = await stat(absPath);
    results.push({ path: `${dir}/${name}`, absPath, mtimeMs: s.mtimeMs });
  }
  return results;
}

/**
 * Walk all three PARA directories.
 */
export function scanAllParaDirs(base: string): Promise<FileEntry[]> {
  return Promise.all(PARA_DIRS.map((d) => scanParaDir(d, base))).then((r) => r.flat());
}

/**
 * Read and parse a file entry: extract frontmatter and body.
 */
export async function parseFile(entry: FileEntry): Promise<ParsedFile> {
  const content = await readFile(entry.absPath, "utf-8");
  const fm = parseFrontmatter(content);

  // Body is everything after the frontmatter block
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

  return {
    title: fm.title ?? entry.path.replace(/\.md$/, "").split("/").pop() ?? "",
    body,
    tags: fm.tags ?? [],
    author: fm.author ?? "",
    editor: fm.editor ?? "",
    created: fm.date ?? fm.created ?? null,
    description: fm.description ?? null,
    source_url: fm.source_url ?? null,
  };
}

/**
 * Slugify a title to a filename-safe string.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
