---
name: auto-link
description: Automatically finds semantically related notes for a newly created note and appends [[wikilinks]] to the most relevant ones, using LLM-powered semantic understanding beyond BM25 keyword matching.
---

# Auto-link

After creating or updating a note, use this skill to find semantically related notes and append permanent `[[wikilinks]]` to them.

**Why the LLM?** BM25 (used by `search_para_docs`) finds keyword matches. The LLM adds deep semantic understanding — catching synonyms, conceptual parallels, analogies, and indirect connections that keyword search misses. This is the same principle as SBERT embeddings, but powered by the model's full contextual reasoning.

## Workflow

### 1. Read the new note

If the note path isn't already known from context, identify it. Read the file to get its full content (title, tags, body).

### 2. Extract key concepts

From the note's title, tags, and body, identify **3–5 key concepts** that best represent the note's semantic core. These should be:
- Specific enough to find relevant matches (e.g., "coping strategy" not just "strategy")
- Diverse enough to cover different angles of the note
- Concepts that might appear in different wording in other notes (e.g., if your note is about "reward-seeking behavior", also search for "instant gratification", "impulse control", "dopamine")

Think of this as: "If another note existed on this subtopic, what would it be titled?"

### 3. Search for related notes

For **each** key concept, run `search_para_docs` with that concept as the query. Aggregate all unique results across all queries.

**Exclude the new note itself** from candidates. The note's slug is its filename without `.md` (e.g., `coping-strategies`). The `search_para_docs` results include `path` fields — filter out any path matching the new note's path.

### 4. LLM-powered semantic evaluation

For each unique candidate document returned, evaluate its semantic relatedness to the new note:

- **Read the candidate's title and tags** (from the search result) to understand its topic
- **Read the candidate's full content** if needed for ambiguous cases
- **Evaluate**: Is this genuinely semantically related? Would a reader navigating the Zettelkasten benefit from a link between these two notes? Is the connection conceptually meaningful?
- **Rate** each candidate as: **strong** / **moderate** / **weak**

Criteria for strong connections:
- They discuss the same concept from complementary angles
- One provides the theoretical foundation, the other an application
- They are siblings under the same broader topic
- They have significant conceptual overlap despite different terminology

### 5. Select top candidates

Choose the top **3–7** candidates with the strongest semantic connections. Keep more if many strong connections exist; fewer if only a few are genuinely related.

### 6. Append links to the note

**First, re-read the note** to get its current body content (everything after the YAML frontmatter `---`).

**Check if it already has a "## Relevant notes" section:**
- **If yes**: Read the existing links. Append any new `[[wikilinks]]` that aren't already present, sorted alphabetically.
- **If no**: Append the following at the end of the body:

```markdown

## Relevant notes

- [[selected-note-slug]]
- [[another-selected-note]]
- ...
```

**Use `update_para_doc`** with the modified content to save the changes.

> **Important:** Use the `[[slug]]` format — the filename without `.md` extension. For example, a note at `Resources/measuring-semantic-similarity-of-contexts.md` becomes `[[measuring-semantic-similarity-of-contexts]]`.

### 7. Confirm with the user

Tell the user what was linked and why. Format like:

> ✅ Auto-linked **"New Note Title"** to 5 related notes:
> - `[[existing-note-1]]` — [brief reason, e.g., "covers the same concept from a different angle"]
> - `[[existing-note-2]]` — [reason]
> - ...

## When to use this skill

This skill is designed to be called **automatically** after a note is created or updated. It can be invoked:
- From the `knowledge` skill after creating a new document
- From the `summarize-link` skill after saving a summary
- Manually via `/skill:auto-link` if the user creates a note externally (e.g., via the `zk` script)

## Provided tools used

This skill relies on:

- `search_para_docs` — BM25 search across PARA documents (candidate retrieval)
- `read` — read note contents for evaluation
- `update_para_doc` — update the note with appended links
