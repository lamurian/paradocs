/**
 * standardize_frontmatter tool — batch rename legacy field names.
 */

import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";

import { Type } from "typebox";

import { analyzeFrontmatter, repairFileFrontmatter } from "./analyzer.js";
import { findParaMdFiles } from "./scanner.js";
import { configureEnv, getKnowledgeConfig } from "../../common/env.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerStandardizeTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "standardize_frontmatter",
    label: "Standardize Frontmatter",
    description: "Batch-rename legacy frontmatter fields to their standardised names.",
    promptSnippet: "Batch standardise frontmatter field names across all PARA documents",
    parameters: Type.Object({
      dryRun: Type.Optional(
        Type.Boolean({
          description:
            "If true, only report what would change without modifying files. Default: true.",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      // Ensure .env is loaded (from ~/.pi/agent/.env and <cwd>/.pi/.env)
      configureEnv(ctx.cwd);

      const baseDir = getKnowledgeConfig(ctx.cwd).dir;
      const dryRun = params.dryRun ?? true;
      const files = await findParaMdFiles(baseDir);
      let changed = 0;
      const details: Array<{ file: string; changes: string[] }> = [];
      const FIELD_ALIASES: Record<string, string> = {
        source_url: "source",
        url: "source",
        created: "date",
      };

      for (const filePath of files) {
        const relPath = relative(baseDir, filePath);
        const content = await readFile(filePath, "utf-8");
        const analysis = analyzeFrontmatter(content);
        const fieldChanges = analysis.keyOrder
          .filter((k) => FIELD_ALIASES[k])
          .map((k) => `'${k}' -> '${FIELD_ALIASES[k]}'`);
        if (fieldChanges.length === 0) continue;

        changed++;
        details.push({ file: relPath, changes: fieldChanges });
        if (!dryRun) {
          const r = await repairFileFrontmatter(
            async (p) => await readFile(p, "utf-8"),
            async (p, c) => await writeFile(p, c, "utf-8"),
            filePath,
          );
          if (r.fixed && r.content) await writeFile(filePath, r.content, "utf-8");
        }
      }

      if (changed === 0)
        return {
          content: [
            { type: "text" as const, text: "All files already use standardised field names." },
          ],
          details: { dryRun, changed: 0 },
        };

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Scanned ${files.length} files`,
              `Found ${changed} file(s) with legacy field names:`,
              "",
              ...details.flatMap((d) => [`**${d.file}**`, ...d.changes.map((c) => `  - ${c}`), ""]),
              dryRun ? "Run with `dryRun: false` to apply changes." : "Changes applied.",
            ].join("\n"),
          },
        ],
        details: { dryRun, changed, files: details },
      };
    },
  });
}
