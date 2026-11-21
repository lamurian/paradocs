/**
 * Ingest tool, command and implementation-complete hook for the PARA outbox.
 *
 * Ingest is the only writer of KNOWLEDGE_DIR files, notes.db and ref.bib. It
 * refuses to run in read-only processes, where staging still writes to the
 * cwd outbox but the knowledge base must stay untouched.
 *
 * @module extensions/para-outbox/ingest-tool
 */

import { Type } from "typebox";

import { getKnowledgeConfig } from "../../common/env.ts";
import { formatIngestReport } from "../../common/ingest-finalize.ts";
import { ingestOutbox } from "../../common/ingest.ts";
import { ensureNotesDb } from "../../common/notesDb.ts";
import { isReadOnlyProcess } from "../../common/runtime.ts";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Message returned when ingest is attempted in a read-only process. */
export const READ_ONLY_INGEST_MESSAGE =
  "ingest is disabled in read-only processes (PARADOCS_READONLY or pi-workflow unit)";

/** Payload published by pi-workflow when implementation completes. */
interface ImplementationCompletePayload {
  cwd?: string;
}

/**
 * Ingest the cwd outbox and publish the report as a custom message.
 *
 * In read-only processes this returns a refusal string without resolving the
 * knowledge configuration, opening notes.db or writing any files.
 *
 * @param pi - The pi extension API used to post the ingested report.
 * @param cwd - Project working directory that owns the outbox.
 * @returns The formatted ingest report, or the read-only refusal message.
 */
export async function runIngest(
  pi: Pick<ExtensionAPI, "sendMessage">,
  cwd: string,
): Promise<string> {
  if (isReadOnlyProcess()) {
    return READ_ONLY_INGEST_MESSAGE;
  }

  const db = await ensureNotesDb(cwd);
  const { dir } = getKnowledgeConfig(cwd);
  const report = await ingestOutbox(cwd, { knowledgeDir: dir, db, now: new Date() });
  const text = formatIngestReport(report);

  pi.sendMessage({ customType: "paradocs-ingest", content: text, display: true });

  return text;
}

/** Register the ingest_para_outbox tool and the /para-ingest command. */
function registerIngestInterface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ingest_para_outbox",
    label: "Ingest PARA Outbox",
    description:
      "Ingest staged PARA notes from .pi/paradocs/outbox into the knowledge base. " +
      "Writes KNOWLEDGE_DIR files, notes.db, ref.bib and one KB commit per run.",
    promptSnippet: "Ingest the staged PARA outbox into the knowledge base",
    promptGuidelines: [
      "Ingest runs automatically at the end of implementation; use ingest_para_outbox only as a manual fallback.",
      "Ingest never overwrites user edits: conflicting updates are parked under .pi/paradocs/outbox/.conflicts.",
    ],
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const report = await runIngest(pi, ctx.cwd);
      return {
        content: [{ type: "text" as const, text: report }],
        details: { report },
      };
    },
  });

  pi.registerCommand("para-ingest", {
    description: "Ingest the staged PARA outbox into the knowledge base.",
    handler: async (_args, ctx) => {
      await runIngest(pi, ctx.cwd);
    },
  });
}

/** Subscribe ingest to the pi-workflow implementation-complete event. */
function registerIngestEvent(pi: ExtensionAPI): void {
  pi.events.on("workflow:implementation_complete", (data) => {
    const payload = data as ImplementationCompletePayload | undefined;
    void runIngest(pi, payload?.cwd ?? process.cwd());
  });
}

/**
 * Register the ingest tool, command and implementation-complete hook.
 *
 * @param pi - The pi extension API.
 */
export function registerIngestTool(pi: ExtensionAPI): void {
  if (typeof pi.registerCommand === "function") {
    registerIngestInterface(pi);
  }
  if (typeof pi.events?.on === "function") {
    registerIngestEvent(pi);
  }
}
