import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

// ─── State ───────────────────────────────────────────────────────────────────

const PARA_PATTERNS = [/^Resources\//, /^Projects\//, /^Areas\//];

interface TurnState {
  searchStarted: boolean;
  searchResultCount: number;   // -1 = not done, 0 = empty, >0 = has results
  readParaFiles: Set<string>;  // PARA files read this turn
}

interface SessionState {
  bypassed: boolean;           // user suspended gates via /bypass-gate
  healthy: boolean;            // false = gate crashed, fail-closed
}

let turn: TurnState = freshTurn();
let session: SessionState = freshSession();

function freshTurn(): TurnState {
  return {
    searchStarted: false,
    searchResultCount: -1,
    readParaFiles: new Set(),
  };
}

function freshSession(): SessionState {
  return {
    bypassed: false,
    healthy: true,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isParaPath(path: string | undefined): boolean {
  if (!path) return false;
  return PARA_PATTERNS.some((re) => re.test(path));
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Session / turn lifecycle ─────────────────────────────────────────────

  pi.on("session_start", () => {
    session = freshSession();
    turn = freshTurn();
  });

  pi.on("turn_start", () => {
    turn = freshTurn();
  });

  // ── Bypass command ───────────────────────────────────────────────────────

  pi.registerCommand("bypass-gate", {
    description: "Suspend all skill gates for this session",
    handler: async (_args, ctx) => {
      session.bypassed = true;
      ctx.ui.notify("Skill gates suspended for this session.", "info");
    },
  });

  // ── Track search ─────────────────────────────────────────────────────────

  pi.on("tool_execution_start", (event) => {
    if (event.toolName === "search_para_docs") {
      turn.searchStarted = true;
    }
  });

  pi.on("tool_result", (event) => {
    if (!session.healthy || event.toolName !== "search_para_docs") return;
    try {
      const text = event.content.find((c): c is { type: "text"; text: string } => c.type === "text")?.text ?? "";
      const matches = text.match(/- \[.*?\]\(.*?\)/g);
      turn.searchResultCount = matches ? matches.length : 0;

      // Option C: extract PARA file paths from search results
      // and treat them as "read" for this turn
      const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
      let linkMatch: RegExpExecArray | null;
      while ((linkMatch = linkRe.exec(text)) !== null) {
        const path = linkMatch[2];
        if (isParaPath(path)) {
          turn.readParaFiles.add(path);
        }
      }
    } catch {
      turn.searchResultCount = 0;
    }
  });

  // ── Track reads ──────────────────────────────────────────────────────────

  pi.on("tool_call", (event) => {
    if (!session.healthy) return;
    if (!isToolCallEventType("read", event)) return;
    if (isParaPath(event.input.path)) {
      turn.readParaFiles.add(event.input.path);
    }
  });

  // ── Main gate ────────────────────────────────────────────────────────────

  pi.on("tool_call", async (event, ctx) => {
    if (!session.healthy || session.bypassed) return;

    // -- create_para_doc / batch_create_para_docs --

    if (
      isToolCallEventType("create_para_doc", event) ||
      isToolCallEventType("batch_create_para_docs", event)
    ) {
      await gateCreate(ctx);
    }

    // -- write into PARA dir --

    if (isToolCallEventType("write", event) && isParaPath(event.input.path)) {
      if (!turn.searchStarted) {
        await warnGate(ctx, "Writing to PARA dir without search first.");
      }
    }

    // -- edit PARA file --

    if (isToolCallEventType("edit", event) && isParaPath(event.input.path)) {
      if (!turn.readParaFiles.has(event.input.path as string)) {
        await warnGate(ctx, `Editing "${event.input.path}" without reading it first.`);
      }
    }

    // -- update_para_doc --

    if (isToolCallEventType("update_para_doc", event)) {
      if (!turn.readParaFiles.has(event.input.path as string)) {
        await warnGate(ctx, `Updating "${event.input.path}" without reading it first.`);
      }
    }
  });

  // ── Circuit breaker ──────────────────────────────────────────────────────

  process.on("unhandledRejection", (reason) => {
    session.healthy = false;
    console.error("[skill-gate] CRASHED — gate disabled:", reason);
  });
}

// ─── Gate logic ──────────────────────────────────────────────────────────────

async function gateCreate(
  ctx: any,
): Promise<void> {
  // 1) Was search run this turn?
  if (!turn.searchStarted) {
    await warnGate(ctx, "Creating document without search first.");
    return;
  }

  // 2) Search is still running (parallel execution) — let it through
  if (turn.searchResultCount === -1) {
    return;
  }

  // 3) Search found existing docs — soft warning, don't block
  if (turn.searchResultCount > 0) {
    await warnGate(ctx, `Search found ${turn.searchResultCount} existing doc(s). Creating anyway.`);
    return;
  }

  // 4) Search returned 0 results — soft warning, don't block
  if (turn.searchResultCount === 0) {
    await warnGate(ctx, "No existing docs found. Creating new document.");
    return;
  }
}

// ─── Gate helper ─────────────────────────────────────────────────────────────

async function warnGate(
  ctx: any,
  message: string,
): Promise<void> {
  if (!ctx.hasUI) return;

  try {
    ctx.ui.notify(message, "warning");
  } catch {
    // notify is fire-and-forget, ignore errors
  }
}
