---
name: summarize-link
description: Fetches a URL shared by the user, checks if a summary already exists (by URL or content similarity), extracts content (HTML via Obscura headless browser, PDF via pdftotext), summarizes it, and delegates document creation to the create-doc skill.
---

# Summarize Link

When the user shares a link (URL) they want processed, follow this workflow.

## Prerequisites

- **Obscura headless browser** — for JavaScript-rendered HTML pages (SPAs, React/Vue).
  Runs in Docker:
  ```
  docker compose -f search-stack/docker-compose.yml up -d
  ```
- **pdftotext** (poppler-utils) — for PDF extraction.
  Install: `apt install poppler-utils` (Debian/Ubuntu) or `brew install poppler` (macOS).

Without Obscura, `fetch_url` falls back to simple HTTP + text stripping, which cannot handle JavaScript-rendered pages.

## Workflow

### 0. Check for existing summary (dedup)

**Before fetching**, call `find_existing_summary` to see if a document with the same URL already exists:

```
find_existing_summary(url: "<the URL>")
```

This tool:
- Queries the DuckDB index for documents whose `source_url` field matches the given URL exactly
- If no exact match is found, computes **Jaccard similarity** (word trigrams) against existing documents
- If an existing summary is found (exact URL match or >90% content similarity), returns the document title and path

**If found:** Inform the user that the link is already summarised. Do not re-summarise. Read the existing document if the user wants details.

**If not found:** Proceed to step 1.

### 1. Fetch the URL content

Use the `fetch_url` tool to fetch and extract content from the link.

```
fetch_url(url: "<the URL the user shared>")
```

The tool:
- **PDFs:** Detects `.pdf` URLs and extracts text using `pdftotext -layout`
- **HTML:** Connects to **Obscura headless browser** via CDP WebSocket, renders the DOM, calls `LP.getMarkdown`
- **Fallback:** Plain HTTP + text stripping if Obscura is not running

Returns: page title, clean Markdown content (or extracted text for PDFs), engine used, character count.

### 2. Read and understand the content

Read the returned Markdown/text. Focus on:
- The main topic and purpose of the page
- Key arguments, findings, or information
- Structure (headings, sections, lists)
- Any data, statistics, or references

### 3. Summarize

Write a concise summary in your own words:

- **Title** — A clear, descriptive title for the document
- **Source** — The original URL and page title
- **Summary** — 2–5 paragraphs capturing the essence of the content
- **Key points** — Bullet list of the most important takeaways
- **Relevance** — Why this might be useful or interesting

### 4. Create a new PARA document via create-doc skill

Run `/skill:create-doc` to create the document. Pass:

- `title` — the descriptive title from step 3
- `content` — the summary, key points, and relevance from step 3, with the source URL included
- `tags` — let create-doc run `list_para_tags` to pick existing tags
- `area` — typically `"Resources"` for reference material. Use `"Areas"` if it relates to an ongoing life responsibility. Use `"Projects"` only if it directly supports an active project.
- `source` — the original URL (stored in frontmatter for dedup)

Recommended content structure for the body:

```markdown
## Source
- **Title:** [Original Page Title]
- **URL:** [Original URL]

## Summary
[2–5 paragraph summary of the content]

## Key Points
- Key takeaway one
- Key takeaway two
- ...

## Relevance
Why this content matters or how it might be useful.
```

### 5. Auto-link to related notes

After the document is created, run `/skill:auto-link` to find semantically related notes and append `[[wikilinks]]`.

### 6. Confirm with the user

Tell the user:
- The document title and path
- A brief note on what was saved
- The source URL
- Offer to refine or expand sections if needed

## Tools used

- `find_existing_summary` — checks DuckDB for existing summary by URL + content similarity
- `fetch_url` — fetches URL content (HTML via Obscura CDP/HTTP, PDF via pdftotext)
