/**
 * Expand Bullet Points Extension
 *
 * Registered tool: expand_bullet_points
 *
 * When the knowledge skill's search_para_docs finds a document that contains
 * unclear bullet points or brief ideation, this tool searches reputable web
 * sources for each bullet and returns expanded, coherent paragraphs.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseFrontmatter, extractBullets, buildSearchQuery, type BulletInfo } from "./parser.js";
import { searchWeb } from "./search.js";
import { synthesizeExpansion, type Expansion } from "./synthesis.js";

const ExpandParams = Type.Object({
  docPath: Type.String({
    description:
      "Relative path to the PARA document containing unclear bullet points, " +
      'e.g. "Projects/definition-of-resilience.md".',
  }),
  bullets: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Specific bullet-point texts to expand. Omit to auto-detect all " +
        "brief bullet points in the document body.",
    }),
  ),
  focusArea: Type.Optional(
    Type.String({
      description:
        "Optional theme or angle to guide the expansion, e.g. 'clinical applications' " +
        "or 'neuroscience research'. Helps narrow the web search.",
    }),
  ),
});

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "expand_bullet_points",
    label: "Expand Bullet Points",
    description:
      "Expands unclear bullet points or brief ideation from a PARA knowledge document " +
      "into coherent, researched paragraphs by searching reputable web sources.",
    promptSnippet:
      "Search reputable web sources and expand unclear bullet points into coherent ideas",
    parameters: ExpandParams,

    /* eslint-disable-next-line complexity */
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const docAbsPath = resolve(ctx.cwd, params.docPath);

      let content: string;
      try {
        content = await readFile(docAbsPath, "utf-8");
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not read document at "${params.docPath}". Make sure the path is correct.`,
            },
          ],
          details: { error: `File not found: ${params.docPath}` },
        };
      }

      const { title, body } = parseFrontmatter(content);

      let bullets: BulletInfo[];
      if (params.bullets?.length) {
        const raw = extractBullets(body);
        const specified = new Set(
          params.bullets.map((b) => b.toLowerCase().replace(/^-\s*/, "").trim()),
        );
        bullets = raw.filter((b) => specified.has(b.text.toLowerCase()));
        if (bullets.length === 0) bullets = raw;
      } else {
        bullets = extractBullets(body);
      }

      if (bullets.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No brief bullet points found in this document." },
          ],
          details: { docPath: params.docPath, bulletCount: 0 },
        };
      }

      onUpdate?.({
        content: [
          {
            type: "text" as const,
            text: `📖 "${title || params.docPath}" — found ${bullets.length} bullet point(s) to expand. Searching reputable web sources…`,
          },
        ],
        details: {},
      });

      const expansions: Expansion[] = [];
      const total = bullets.length;

      for (let i = 0; i < total; i++) {
        const bullet = bullets[i];
        onUpdate?.({
          content: [
            {
              type: "text" as const,
              text: `🔍 [${i + 1}/${total}] Searching: "${bullet.text}"${bullet.context ? ` (context: ${bullet.context})` : ""}`,
            },
          ],
          details: {},
        });

        let query = buildSearchQuery(bullet);
        if (params.focusArea) query = `${params.focusArea} ${query}`;

        const results = await searchWeb(pi, query);
        const expanded = synthesizeExpansion(bullet, results);

        expansions.push({
          original: bullet.text,
          context: bullet.context,
          expanded,
          sources: results.filter((r) => r.url.length > 0),
        });
      }

      const lines: string[] = [
        `# Expanded Bullet Points — "${title || params.docPath}"`,
        "",
        `Source documents searched: ${bullets.length} bullet(s) expanded from reputable web sources.`,
        "",
      ];

      for (const exp of expansions) {
        lines.push(`## ${exp.original}`);
        if (exp.context) lines.push(`*Context: ${exp.context}*`);
        lines.push("", exp.expanded, "");
        if (exp.sources.length > 0) {
          lines.push("**Sources:**");
          for (const src of exp.sources) lines.push(`- [${src.title}](${src.url})`);
        }
        lines.push("", "---", "");
      }

      lines.push(
        "To save these expansions back to the document, call `update_para_doc` with the enriched body content.",
      );

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: {
          docPath: params.docPath,
          bulletCount: total,
          expansions: expansions.map((e) => ({
            original: e.original,
            context: e.context,
            expanded: e.expanded,
            sources: e.sources,
          })),
        },
      };
    },
  });
}
