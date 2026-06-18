/**
 * File scanner for yaml-enforcer.
 * Finds PARA markdown files in Areas/Projects/Resources.
 */

import { readdir } from "node:fs/promises";
import { resolve, join } from "node:path";

const PARA_DIRS = ["Areas", "Projects", "Resources"] as const;

export async function findParaMdFiles(baseDir: string): Promise<string[]> {
  const files: string[] = [];
  for (const dir of PARA_DIRS) {
    const abs = resolve(baseDir, dir);
    try {
      const entries = await readdir(abs);
      for (const name of entries) {
        if (name.endsWith(".md")) files.push(join(abs, name));
      }
    } catch {
      /* directory doesn't exist yet */
    }
  }
  return files.sort();
}
