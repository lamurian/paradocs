---
name: knowledge
description: Answers questions by first searching PARA-organized markdown files (Areas, Projects, Resources). If no document matches, clarifies via brainstorm, searches the web via web-search skill, then creates a new document via create-doc skill.
---

# Knowledge Agent

When the user asks a question about a topic, follow this workflow.

## Workflow

### 1. Search existing documents

Use `search_para_docs` to find markdown files in `Areas/`, `Projects/`, `Resources/` that match via tags and content.

### 2. If matching documents exist

- `read` the most relevant document(s)
- Answer the user using the content
- Cite every claim using Pandoc-style citation keys (see the citation format in `/skill:create-doc`)
- Present any points for improvement
- If user confirms, use `update_para_doc` to apply improvements and renew frontmatter

### 3. If no documents match

- Inform the user that no document covers this topic yet
- Run `/skill:brainstorm` to clarify and refine the question
- Run `/skill:web-search "<refined question>"` (defaults to tier 2 for general Q&A, but use tier 1 for academic topics)
- Summarise findings to the user
- Run `/skill:create-doc` to create the document with proper citations and classification
- Run `/skill:auto-link` to find semantically related notes and append `[[wikilinks]]`

## Tools used

This skill relies on tools provided by the para-knowledge extension:

- `search_para_docs` — search by tags and content in Areas/Projects/Resources
- `read` — read file contents
- `update_para_doc` — update existing document and renew frontmatter
