/* eslint-disable */
/**
 * Split Command Handler — decompose a non-atomic PARA document into atomic notes.
 *
 * Reads a markdown file, uses an LLM sub-agent to identify logical subtopics
 * (each with one question and one answer), previews the splits for confirmation,
 * then creates them via batch_create_para_docs. The original file is rewritten
 * as an executive summary linking to the new atomic notes.
 *
 * @module extensions/commands/split
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import { validateAtomicity } from "../../common/atomicity.js";
import type { Model, Api } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
interface ProposedSplit {
  title: string;
  content: string;
  tags: string[];
  area: "Resources" | "Areas" | "Projects";
  question: string;
  answer: string;
}
interface SplitAnalysis {
  splits: ProposedSplit[];
  executiveSummary: string;
  isAtomic: boolean;
}

/**
 * Parse frontmatter from markdown content.
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: {}, body: content };
  try {
    const yaml = match[1];
    const frontmatter: Record<string, unknown> = {};
    for (const line of yaml.split("\n")) {
      const [key, ...rest] = line.split(":");
      if (key && rest.length > 0) {
        let value: string | boolean | number = rest.join(":").trim();
        if (value.startsWith("[") && value.endsWith("]")) {
          value = JSON.parse(value);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        } else if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (value === "true" || value === "false") {
          value = value === "true";
        } else if (!isNaN(Number(value))) {
          value = Number(value);
        }
        frontmatter[key.trim()] = value;
      }
    }
    return { frontmatter, body: content.slice(match[0].length + 1).trim() };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

/**
 * Format frontmatter as YAML string.
 */
function formatFrontmatter(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => `"${v}"`).join(", ")}]`);
    } else if (typeof value === "string") {
      lines.push(`${key}: "${value}"`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * Extract question/answer from atomic note content.
 */
function extractQA(body: string): { question: string; answer: string } {
  const lines = body.split("\n");
  let question = "What are the key characteristics and trade-offs of this topic?";
  let answer =
    "This note covers the essential aspects including pros, cons, indications, and contraindications.";
  // Look for explicit questions
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.endsWith("?") && trimmed.length > 10) {
      question = trimmed;
      break;
    }
  }
  // Look for answer-like summary in first paragraph after ## Summary
  let inSummary = false;
  for (const line of lines) {
    if (line.startsWith("## Summary")) {
      inSummary = true;
      continue;
    }
    if (inSummary && line.startsWith("##")) break;
    if (inSummary && line.trim() && !line.startsWith("#")) {
      answer = line.trim().slice(0, 200);
      break;
    }
  }

  return { question, answer };
}
/**
 * Create the executive summary document that references all splits.
 */
function createExecutiveSummaryDoc(
  originalTitle: string,
  originalFrontmatter: Record<string, unknown>,
  splits: ProposedSplit[],
  executiveSummary: string,
): string {
  const tags = (originalFrontmatter.tags as string[]) ?? [];
  const area = (originalFrontmatter.area as "Resources" | "Areas" | "Projects") ?? "Resources";
  const frontmatter = {
    title: originalTitle,
    author: originalFrontmatter.author ?? "pi",
    editor: "lam",
    date: new Date().toISOString(),
    tags: [...tags, "executive-summary", "split-source"],
    area,
    description:
      originalFrontmatter.description ?? `Executive summary of ${splits.length} atomic notes`,
    source: originalFrontmatter.source ?? null,
  };
  const links = splits
    .map((s) => {
      const slug = s.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      return `- [${s.title}](${slug}.md) — ${s.question}`;
    })
    .join("\n");
  const body = `${executiveSummary}
## Atomic Notes
${links}
---
*This document was split from a composite note on ${new Date().toISOString().split("T")[0]}. Each linked note above addresses one research question with one indicative answer.*
`;
  return formatFrontmatter(frontmatter) + "\n" + body;
}
/**
 * Prepare batch_create_para_docs arguments from proposed splits.
 */
function prepareBatchDocs(splits: ProposedSplit[]): Array<{
  title: string;
  content: string;
  tags: string[];
  area: string;
  description: string;
}> {
  return splits.map((s) => ({
    title: s.title,
    content: s.content,
    tags: s.tags,
    area: s.area,
    description: `Atomic note: ${s.question}`,
  }));
}
/**
 * Analyze document for atomic splits using the LLM sub-agent.
 */
async function analyzeForSplits(
  title: string,
  body: string,
  model: Model<Api>,
): Promise<SplitAnalysis> {
  if (!model) {
    throw new Error("No model available for split analysis");
  }
  const result = await validateAtomicity(body, title, model);
  if (result.valid) {
    return { splits: [], executiveSummary: "", isAtomic: true };
  }
  if (!result.suggestedSplits || result.suggestedSplits.length === 0) {
    throw new Error(`Document is non-atomic but no splits suggested: ${result.message}`);
  }
  // Convert to our format with extracted Q&A
  const splits: ProposedSplit[] = result.suggestedSplits.map((s) => {
    const { question, answer } = extractQA(s.content);
    return {
      title: s.title,
      content: s.content,
      tags: s.tags,
      area: s.area as "Resources" | "Areas" | "Projects",
      question,
      answer,
    };
  });
  const executiveSummary = `This document was split into ${splits.length} atomic notes, each addressing a distinct research question with one indicative answer.`;
  return { splits, executiveSummary, isAtomic: false };
}
/**
 * Create the /split command handler.
 */
export function createSplitHandler(pi: ExtensionAPI) {
  return async function splitHandler(args: string, ctx: ExtensionCommandContext) {
    const filePath = args.trim();
    if (!filePath) {
      ctx.ui.notify("Usage: /split <path/to/file.md>", "error");
      return;
    }
    const resolvedPath = resolve(ctx.cwd, filePath);
    ctx.ui.notify(`Reading ${filePath}...`, "info");
    let content: string;
    try {
      content = await readFile(resolvedPath, "utf-8");
    } catch (err) {
      ctx.ui.notify(`Failed to read file: ${err}`, "error");
      return;
    }
    const { frontmatter, body } = parseFrontmatter(content);
    const title = (frontmatter.title as string) ?? basename(filePath, extname(filePath));
    ctx.ui.notify(`Analyzing document for atomic splits...`, "info");
    // Step 1: Analyze with LLM sub-agent
    let analysis: SplitAnalysis;
    try {
      analysis = await analyzeForSplits(title, body, ctx.model!);
    } catch (err) {
      ctx.ui.notify(`Split analysis failed: ${err}`, "error");
      return;
    }
    if (analysis.isAtomic) {
      ctx.ui.notify("Document is already atomic — no split needed", "info");
      return;
    }
    // Step 2: Preview splits for confirmation
    const previewLines = analysis.splits
      .map(
        (s, i) =>
          `${i + 1}. **${s.title}** (${s.area}) — tags: ${s.tags.join(", ")}\n     Q: ${s.question}\n     A: ${s.answer}`,
      )
      .join("\n\n");
    const confirmed = await ctx.ui.confirm(
      `Proposed ${analysis.splits.length} atomic notes:\n\n${previewLines}\n\nCreate these notes and rewrite original as executive summary?`,
      "Confirm split",
    );
    if (!confirmed) {
      ctx.ui.notify("Split cancelled", "info");
      return;
    }
    // Step 3: Create atomic notes via batch_create_para_docs
    ctx.ui.notify("Creating atomic notes via batch_create_para_docs...", "info");
    const batchDocs = prepareBatchDocs(analysis.splits);
    try {
      // Trigger batch creation through the agent
      const _toolCallMessage = JSON.stringify({
        tool: "batch_create_para_docs",
        arguments: {
          documents: batchDocs,
          autoLink: true,
        },
      });
      pi.sendUserMessage(
        `Create these ${batchDocs.length} atomic notes via batch_create_para_docs:\n${JSON.stringify(batchDocs, null, 2)}`,
        { deliverAs: "followUp" },
      );
      // Wait for batch creation to complete
      await new Promise((r) => setTimeout(r, 3000));
    } catch (err) {
      ctx.ui.notify(`Failed to create atomic notes: ${err}`, "error");
      return;
    }
    // Step 4: Rewrite original file as executive summary
    ctx.ui.notify("Rewriting original file as executive summary...", "info");
    try {
      const execSummary = createExecutiveSummaryDoc(
        title,
        frontmatter,
        analysis.splits,
        analysis.executiveSummary,
      );
      await writeFile(resolvedPath, execSummary, "utf-8");
      ctx.ui.notify(
        `✅ Split complete! Original file updated as executive summary at ${filePath}`,
        "info",
      );
    } catch (err) {
      ctx.ui.notify(`Failed to write executive summary: ${err}`, "error");
    }
  };
}
/**
 * Description for the /split command.
 */
export const splitDescription =
  "Split a non-atomic PARA document into atomic notes. Usage: /split <path/to/file.md>";
