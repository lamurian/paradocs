---
name: create-doc
description: Single source of truth for PARA document creation — standards, citation workflow, and classification. Called by skills that need to create new knowledge documents.
---

# Create Doc

Call this skill when you need to create a new PARA knowledge document. It defines the standards, citation workflow, and classification rules. Other skills (knowledge, research, roadmap, summarize-link) delegate their document-creation steps here.

## Call interface

```
/skill:create-doc
```

Parameters are passed from the calling skill's context: title, content, tags, area, description, source, citations.

## Workflow

### 1. List existing tags

Always run `list_para_tags` first. Choose tags from the returned array. Only create new tags when none of the existing ones fit the topic.

### 2. Classify the document

Choose the PARA area based on content type:

| Content type | Area | Example tags |
|---|---|---|
| General reference, concepts, theory | `"Resources"` | `"reference"`, `"fundamental"` |
| Active skill development, ongoing responsibility | `"Areas"` | `"health"`, `"finance"`, `"learning"` |
| Practical work, exercises, deliverables | `"Projects"` | `"practical"`, `"capstone"` |
| Research atomic notes, executive summaries | `"Resources"` | `"research"`, `"executive-summary"` |
| Roadmap atomic notes (fundamental) | `"Resources"` | `"roadmap"`, `"fundamental"` |
| Roadmap atomic notes (practical) | `"Projects"` | `"roadmap"`, `"practical"` |
| Roadmap master document | `"Projects"` | `"roadmap"`, `"index"` |

### 3. Resolve citations (if any)

For each source you decide to cite, call `resolve_citation`:

```
resolve_citation(source: "<DOI or URL>")
resolve_citation(source: "<URL>", title: "<title>", authors: ["Last, First"], year: 2024)
```

The tool returns a unique citekey (e.g. `kucsko2013`). It handles dedup — same DOI or URL returns the existing key.

**Rules:**
- Every factual claim from a web source must trace back to a citekey
- Citekey format: `{lastname}{year}` (lowercase), e.g. `kucsko2013`
- If collisions occur, the tool appends `a`, `b`, `c`...
- Existing PARA notes don't need BibTeX entries — just use `[[wikilink]]`

### 4. Apply atomic principle

Each note holds exactly one key idea.

- Max 4 paragraphs per note, or two heading sections (not counting summary section)
- If a note exceeds 100 lines (including frontmatter), split it
- One note = one concept, one finding, one technique, one reference

### 5. Write in casual business English

- Short simple sentences over long complex ones
- No emojis, no exclamation marks, no slang
- Only headings use markdown formatting
- Use plain text, quotes, and code blocks
- Be direct and factual

### 5.5. Use standard markdown math syntax

For multi-line (display) mathematical equations, use standard Markdown `$$` delimiters with the equation on its own line:

```markdown
$$
\hat{\theta}_i = \theta + \sqrt{\tau^2 + \sigma_i^2}\; \varepsilon_i, \quad \varepsilon_i \sim N(0,1)
$$
```

Do not use LaTeX-style `\[ ... \]` or `[ ... ]` delimiters for display math. For inline math (within a sentence), use `\( ... \)`.

### 6. Use inline citations

Pandoc-style citation keys referencing `@ref.bib`:

| Syntax | Example |
|---|---|
| `[@citekey]` — parenthetical | `Dopamine depletion impairs effort-cost computation [@kucsko2013].` |
| `@citekey` — narrative | `Kucsko et al. @kucsko2013 demonstrated that...` |
| Multiple sources | `Multiple studies confirm this [@kucsko2013; @daw2006].` |

### 7. Cross-reference with wikilinks

Use `[[wikilink]]` to reference other notes in the knowledge base:
- `[[note-title]]` links to the note by slug (filename without `.md`)
- Use wikilinks for prerequisite notes, related concepts, and further reading

### 8. Use correct frontmatter and naming

The `create_para_doc` and `batch_create_para_docs` tools auto-generate YAML frontmatter. Provide:
- `title` — descriptive, searchable
- `tags` — from Step 1 (reuse existing)
- `area` — from Step 2
- `description` — short summary ≤ 200 characters
- `source` — original URL if summarising external content

The tools auto-set: `author: pi`, `editor: lam`, `date` (current timestamp).

Filenames are auto-generated from the title via kebab-case slugification. Keep titles concise.

### 9. Choose creation method

**Single document:**
Use `create_para_doc` with the prepared parameters.

**Multiple documents (batch):**
Use `batch_create_para_docs` with `autoLink: true`. This creates all docs, indexes them, and auto-links them to each other.

### Recommended body structure

For reference and summary documents:

```markdown
## Summary
[2-4 paragraphs synthesising the key idea]

## Key Points
- Point one
- Point two
- ...

## Sources
- [[wikilink to related existing note]]
- [@citekey] from ref.bib
```

Research atomic notes can be leaner — just the key idea in 2-4 paragraphs with inline citations.

## What this skill does NOT do

- Does not decide what content to write — the calling skill provides that
- Does not auto-link after creation — call `/skill:auto-link` separately if needed
- Does not search the web — call `/skill:web-search` for that
