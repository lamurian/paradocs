import { complete } from "@earendil-works/pi-ai";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";

import { ensureNotesDb } from "../../common/notesDb.js";
import { searchDocs } from "../para-knowledge/db-sqlite.js";

import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export const description = "Ask a question and get an answer or research plan";

const FALLBACK_PLAN = (q: string) =>
  `## Research Plan\n\n**Question**: ${q}\n\n**Phase 1**: Sufficiency check — search notes.db\n\n**Phase 2**: Web search — search for: ${q}\n\n**Phase 3**: Fetch and cite — fetch_url then resolve_citation\n\n**Phase 4**: Synthesize — create atomic notes using create_para_doc`;

const PROMPT = `You evaluate sufficiency of knowledge base results. Return ONLY valid JSON.
If sufficient: {"sufficient":true,"answer":"answer with @citekey citations"}
If insufficient: {"sufficient":false,"plan":"## Research Plan\\n**Question**: {q}\\n**Phase 1**: Sufficiency check\\n**Phase 2**: Web search\\n**Phase 3**: Fetch and cite\\n**Phase 4**: Synthesize — create atomic notes using create_para_doc"}
Cite sources with @citekey when sufficient.`;

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
          let parsed: { sufficient: boolean; answer?: string; plan?: string };
          try {
            parsed = JSON.parse(text) as { sufficient: boolean; answer?: string; plan?: string };
          } catch {
            parsed = { sufficient: false, plan: FALLBACK_PLAN(q) };
          }
          done({
            sufficient: parsed.sufficient ?? false,
            answer: parsed.answer,
            plan: parsed.plan,
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
      if (result.sufficient && result.answer) {
        pi.sendUserMessage(
          `## Answer: ${q}\n\n${result.answer}\n\n---\n*Based on existing knowledge — no new note created.*`,
        );
      } else if (result.plan) {
        pi.sendUserMessage(result.plan);
      }
    }
  };
}
