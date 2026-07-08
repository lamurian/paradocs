/**
 * /ask command — knowledge base sufficiency check with plan generation.
 *
 * Searches existing PARA docs for a question, evaluates sufficiency via LLM,
 * and either answers from existing knowledge or generates a structured research
 * plan for the agent to execute.
 *
 * @module extensions/commands/ask
 */

import { complete } from "@earendil-works/pi-ai";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";

import { createDocument } from "../../common/createDocument.js";
import { extractJson } from "../../common/extractJson.js";
import { commitKnowledgeBase } from "../../common/gitCommit.js";
import { ensureNotesDb } from "../../common/notesDb.js";
import { searchDocs } from "../para-knowledge/db-sqlite.js";

import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export const description = "Ask a question and get an answer or research plan";

export const FALLBACK_PLAN = (q: string) =>
  `## Research Plan\n\n**Question**: ${q}\n\n**Phase 1**: Sufficiency check — search notes.db\n\n**Phase 2**: Web search — search for: ${q}\n\n**Phase 3**: Fetch and cite — fetch_url then resolve_citation\n\n**Phase 4**: Synthesize — create atomic notes using create_para_doc`;

export const PROMPT = `You evaluate sufficiency of knowledge base results. Return ONLY valid JSON.
If sufficient: {"sufficient":true,"answer":"answer with @citekey citations"}
If insufficient: {"sufficient":false,"plan":"## Research Plan\\n**Question**: {q}\\n**Phase 1**: Sufficiency check\\n**Phase 2**: Web search\\n**Phase 3**: Fetch and cite\\n**Phase 4**: Synthesize — create atomic notes using create_para_doc"}
Cite sources with @citekey when sufficient.
Optional "commitMessage": descriptive git commit message for the new note, e.g. "docs: add synthesis of dopamine's role in wanting vs liking"`;

export function createHandler(pi: ExtensionAPI) {
  return async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const q = args.trim();
    if (!q) {
      ctx.ui.notify("Usage: /ask <question> — please provide a question.", "warning");
      return;
    }
    if (typeof ctx.ui.custom !== "function") {
      ctx.ui.notify("/ask requires interactive (TUI) mode.", "error");
      return;
    }
    if (!ctx.model) {
      ctx.ui.notify("No model selected. Please select a model first (Ctrl+P).", "error");
      return;
    }
    ctx.ui.notify(`🔍 Checking: "${q.slice(0, 80)}…"`, "info");

    const result = await ctx.ui.custom<{
      sufficient: boolean;
      answer?: string;
      plan?: string;
      createNote?: boolean;
      noteTitle?: string;
      noteContent?: string;
      noteTags?: string[];
      commitMessage?: string;
    } | null>((tui, theme, _kb, done) => {
      const loader = new BorderedLoader(tui, theme, "Checking knowledge base...");
      loader.onAbort = () => done(null);

      const run = async () => {
        try {
          const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model! as Model<Api>);
          if (!auth.ok || !auth.apiKey) {
            done(null);
            return;
          }

          const db = await ensureNotesDb(ctx.cwd);
          const docs = searchDocs(db, q, {}, 10);
          const ctxStr =
            docs.length === 0
              ? "No existing PARA documents found."
              : docs
                  .map((r) => `- **${r.title}** (\`${r.path}\`): ${r.body.slice(0, 300)}`)
                  .join("\n");

          const response = await complete(
            ctx.model!,
            {
              systemPrompt: PROMPT,
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: `Question: ${q}\n\nExisting PARA docs:\n${ctxStr}` },
                  ],
                  timestamp: Date.now(),
                },
              ],
            },
            { apiKey: auth.apiKey, headers: auth.headers, signal: loader.signal },
          );

          const text = response.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n")
            .trim();
          let parsed: {
            sufficient: boolean;
            answer?: string;
            plan?: string;
            createNote?: boolean;
            noteTitle?: string;
            noteContent?: string;
            noteTags?: string[];
            commitMessage?: string;
          };
          const extracted = extractJson(text);
          if (extracted !== null) {
            parsed = extracted as { sufficient: boolean; answer?: string; plan?: string };
          } else {
            parsed = { sufficient: false, plan: FALLBACK_PLAN(q) };
          }
          done({
            sufficient: parsed.sufficient ?? false,
            answer: parsed.answer,
            plan: parsed.plan,
            createNote: parsed.createNote,
            noteTitle: parsed.noteTitle,
            noteContent: parsed.noteContent,
            noteTags: parsed.noteTags,
            commitMessage: parsed.commitMessage,
          });
        } catch (err) {
          console.error("[ask]", err);
          ctx.ui.notify(`❌ Error: ${err instanceof Error ? err.message : String(err)}`, "error");
          done(null);
        }
      };
      void run();
      return loader;
    });

    if (result) {
      await handleSufficiencyResult(result, q, ctx.cwd, pi);
    }
  };
}

/**
 * Handle the sufficiency result by creating a document or showing the plan.
 *
 * Extracted to reduce complexity of the main handler.
 */
async function handleSufficiencyResult(
  result: {
    sufficient: boolean;
    answer?: string;
    plan?: string;
    createNote?: boolean;
    noteTitle?: string;
    noteContent?: string;
    noteTags?: string[];
    commitMessage?: string;
  },
  question: string,
  cwd: string,
  pi: ExtensionAPI,
): Promise<void> {
  if (result.sufficient && result.answer) {
    if (result.createNote && result.noteTitle && result.noteContent) {
      // Novel synthesis across multiple docs — save as new atomic note
      const doc = await createDocument(
        {
          title: result.noteTitle,
          content: result.noteContent,
          tags: result.noteTags ?? ["generated"],
          area: "Resources",
          description: result.answer.slice(0, 200).replace(/\n/g, " "),
        },
        { cwd },
      );
      // Auto-commit to knowledge base repo
      if (result.commitMessage) {
        await commitKnowledgeBase(result.commitMessage, cwd);
      }

      const linkStr =
        doc.linkCount > 0
          ? `🔗 linked to ${doc.linkCount} related note${doc.linkCount === 1 ? "" : "s"}`
          : "no auto-links";
      const commitStr = result.commitMessage ? `\n💾 Committed: \`${result.commitMessage}\`` : "";
      pi.sendUserMessage(
        `## Answer: ${question}\n\n${result.answer}\n\n---\n📄 Note saved to knowledge base: \`${doc.path}\` (${linkStr})${commitStr}`,
      );
    } else {
      // Just answer from existing knowledge, no note needed
      pi.sendUserMessage(
        `## Answer: ${question}\n\n${result.answer}\n\n---\n*Based on existing knowledge — no new note created.*`,
      );
    }
  } else if (result.plan) {
    pi.sendUserMessage(result.plan);
  }
}
