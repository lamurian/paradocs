---
title: Mandatory Citation Resolution
description: Every web source used in note synthesis must have a resolved BibTeX citekey before the note can be created
status: proposed
remaining: 1
date: 2026-06-22
---

# Context

Currently, citation resolution via resolve_citation is used in the /ask orchestrator but not enforced as a hard requirement. Sources can end up in notes without BibTeX entries, making them uncitable and breaking the knowledge base reference integrity. Options considered: (a) soft recommendation - agents may skip resolution; (b) hard enforcement at tool level - create_para_doc rejects content with unresolved citations; (c) pre-flight check before note creation. The resolve_citation tool already handles deduplication and BibTeX generation. The gap is that nothing enforces its use. Enforcing at the tool level (option b) is the most deterministic approach.

# Decision

Add a citation validation step inside create_para_doc and batch_create_para_docs that runs after content is submitted but before file creation: (1) scan the content body for all @citekey references using regex; (2) check each referenced citekey exists in the SQLite citations table; (3) if any citekey is missing or is @? (unresolved), reject with a clear error listing the unresolved citekeys and instructing the agent to call resolve_citation first. Sources from PARA docs (internal references) are exempt - they use file paths, not citekeys.

# Impact

Benefits: guarantees every note has complete citation metadata; prevents orphaned @? references; enforces the resolve-before-create workflow. Costs: adds a regex scan + DB query per document creation (~1-2ms overhead). Risk: false positives if citekey lookup fails due to DB race conditions - mitigated by sequential tool execution. Existing notes are not retroactively validated.
