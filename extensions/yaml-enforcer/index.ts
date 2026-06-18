/**
 * YAML Enforcer Extension — validates and repairs YAML frontmatter
 * in PARA markdown documents.
 *
 * Tools: validate_frontmatter, check_frontmatter, standardize_frontmatter
 * Hook: auto-repair after create/update_para_doc
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { analyzeFrontmatter, repairFileFrontmatter, type FrontmatterIssue } from "./analyzer.js";
import { findParaMdFiles } from "./scanner.js";
import { registerStandardizeTool } from "./standardize-tool.js";
import { registerCheckTool } from "./check-tool.js";

function buildReport(
  filesToCheck: string[],
  totalIssues: number,
  totalFixed: number,
  results: Array<{ file: string; issues: FrontmatterIssue[]; fixed: boolean; changes: string[] }>,
  doRepair: boolean,
): string {
  const summary: string[] = [
    `Scanned ${filesToCheck.length} file(s)`,
    `Found ${totalIssues} issue(s)`,
    ...(doRepair ? [`Fixed ${totalFixed} issue(s)`] : []),
    "",
  ];
  for (const r of results) {
    if (r.issues.length === 0) continue;
    summary.push(`**${r.file}**${r.fixed ? " Fixed" : ""}`);
    for (const issue of r.issues) {
      summary.push(`  - [${issue.type}] ${issue.message}`);
      if (issue.suggestion) summary.push(`    -> ${issue.suggestion}`);
    }
    if (r.fixed) for (const c of r.changes) summary.push(`    v ${c}`);
    summary.push("");
  }
  if (!doRepair && totalIssues > 0) summary.push("Run with `repair: true` to fix.");
  return summary.join("\n");
}

function readUtf8(p: string): Promise<string> {
  return readFile(p, "utf-8");
}
function writeUtf8(p: string, c: string): Promise<void> {
  return writeFile(p, c, "utf-8");
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "validate_frontmatter",
    label: "Validate Frontmatter",
    description: "Scan all PARA markdown files and check for invalid YAML frontmatter.",
    promptSnippet: "Scan and validate YAML frontmatter of PARA documents",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Specific file path. Omit to scan all." })),
      repair: Type.Optional(Type.Boolean({ description: "Auto-repair issues. Default: false." })),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const baseDir = ctx.cwd;
      const doRepair = params.repair ?? false;
      const filesToCheck: string[] = params.path
        ? [resolve(baseDir, params.path)]
        : await findParaMdFiles(baseDir);
      if (filesToCheck.length === 0)
        return {
          content: [{ type: "text" as const, text: "No PARA files found." }],
          details: { scanned: 0, issues: 0, fixed: 0, results: [] },
        };

      let totalIssues = 0,
        totalFixed = 0;
      const results: Array<{
        file: string;
        issues: FrontmatterIssue[];
        fixed: boolean;
        changes: string[];
      }> = [];

      for (const filePath of filesToCheck) {
        const relPath = relative(baseDir, filePath);
        try {
          const content = await readUtf8(filePath);
          const analysis = analyzeFrontmatter(content);
          if (analysis.issues.length === 0) continue;

          totalIssues += analysis.issues.length;
          if (doRepair) {
            const repairResult = await repairFileFrontmatter(readUtf8, writeUtf8, filePath);
            if (repairResult.fixed && repairResult.content) {
              await writeUtf8(filePath, repairResult.content);
              totalFixed += repairResult.changes.length;
              results.push({
                file: relPath,
                issues: analysis.issues,
                fixed: true,
                changes: repairResult.changes,
              });
              continue;
            }
          }
          results.push({ file: relPath, issues: analysis.issues, fixed: false, changes: [] });
        } catch (e: unknown) {
          results.push({
            file: relPath,
            issues: [
              {
                type: "invalid-yaml",
                message: `Error: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
            fixed: false,
            changes: [],
          });
          totalIssues++;
        }
      }

      if (totalIssues === 0)
        return {
          content: [{ type: "text" as const, text: `All ${filesToCheck.length} files valid.` }],
          details: { scanned: filesToCheck.length, issues: 0 },
        };
      return {
        content: [
          {
            type: "text" as const,
            text: buildReport(filesToCheck, totalIssues, totalFixed, results, doRepair),
          },
        ],
        details: {
          scanned: filesToCheck.length,
          issues: totalIssues,
          fixed: doRepair ? totalFixed : 0,
          results: results.map((r) => ({
            file: r.file,
            issueCount: r.issues.length,
            fixed: r.fixed,
            changes: r.changes,
          })),
        },
      };
    },
  });

  registerStandardizeTool(pi);
  registerCheckTool(pi);

  pi.on("tool_result", async (event, _ctx) => {
    if (event.toolName !== "create_para_doc" && event.toolName !== "update_para_doc") return;
    const filePath = (event.details as Record<string, unknown> | undefined)?.path as
      | string
      | undefined;
    if (!filePath) return;

    try {
      const content = await readUtf8(filePath);
      const analysis = analyzeFrontmatter(content);
      if (analysis.issues.length === 0) return;

      const repairResult = await repairFileFrontmatter(readUtf8, writeUtf8, filePath);
      if (repairResult.fixed && repairResult.content) {
        await writeUtf8(filePath, repairResult.content);
        return {
          content: [
            ...(event.content ?? []),
            { type: "text" as const, text: `\nAuto-repaired: ${repairResult.changes.join(", ")}` },
          ],
          details: { ...(event.details ?? {}), yamlRepaired: repairResult.changes },
        };
      }
    } catch {
      /* silent */
    }
  });
}
