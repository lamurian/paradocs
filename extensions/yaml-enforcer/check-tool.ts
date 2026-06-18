/**
 * check_frontmatter tool — check a specific file for YAML issues.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { analyzeFrontmatter, repairFileFrontmatter } from "./analyzer.js";

export function registerCheckTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "check_frontmatter",
    label: "Check Frontmatter",
    description: "Check a single file's YAML frontmatter for validity and standardisation issues.",
    promptSnippet: "Check a specific PARA document's YAML frontmatter for issues",
    parameters: Type.Object({
      path: Type.String({
        description: "Relative path to the markdown file, e.g. Resources/my-doc.md",
      }),
      repair: Type.Optional(
        Type.Boolean({ description: "Repair issues if found. Default: false." }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const filePath = resolve(ctx.cwd, params.path);
      const doRepair = params.repair ?? false;

      try {
        const content = await readFile(filePath, "utf-8");
        const analysis = analyzeFrontmatter(content);
        const relPath = relative(ctx.cwd, filePath);

        const lines = [
          `**${relPath}**`,
          `Frontmatter: ${analysis.hasFrontmatter ? "Present" : "Missing"}`,
          `Fields: ${analysis.keyOrder.join(", ") || "(none)"}`,
          `Issues: ${analysis.issues.length}`,
          "",
        ];

        if (analysis.issues.length === 0) lines.push("Frontmatter is valid.");
        else
          for (const issue of analysis.issues) {
            lines.push(`- [${issue.type}] ${issue.message}`);
            if (issue.suggestion) lines.push(`  -> ${issue.suggestion}`);
          }

        if (doRepair && analysis.issues.length > 0) {
          const repairResult = await repairFileFrontmatter(
            async (p) => await readFile(p, "utf-8"),
            async (p, c) => await writeFile(p, c, "utf-8"),
            filePath,
          );
          if (repairResult.fixed && repairResult.content) {
            await writeFile(filePath, repairResult.content, "utf-8");
            lines.push("", "Repairs:", ...repairResult.changes.map((c) => `  v ${c}`));
          }
        } else if (!doRepair && analysis.issues.length > 0) {
          lines.push("", "Run with `repair: true` to fix.");
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {
            file: relPath,
            hasFrontmatter: analysis.hasFrontmatter,
            issues: analysis.issues,
            keyOrder: analysis.keyOrder,
          },
        };
      } catch (e: unknown) {
        return {
          isError: true,
          content: [
            { type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` },
          ],
          details: {},
        };
      }
    },
  });
}
