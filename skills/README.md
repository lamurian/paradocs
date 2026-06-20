# Skills Directory (Inactive)

This directory contains archived skill files that were previously loaded by pi
via `package.json` → `pi.skills`. The skills have been replaced by tool
descriptions and slash command workflows (see `extensions/commands/`).

## Status

- **Inactive**: pi no longer loads these skills.
- **Preserved**: Files remain on disk for reference and safe rollback.
- **To restore**: Add `"skills": ["./skills"]` back to `package.json` → `pi.skills`.

## Skill Reference

| Directory         | Purpose                           |
|-------------------|-----------------------------------|
| `auto-link/`      | Semantic auto-linking via LLM     |
| `brainstorm/`     | Structured question clarification |
| `create-doc/`     | PARA document creation standards  |
| `knowledge/`      | Knowledge Q&A workflow            |
| `research/`       | Academic research workflow        |
| `summarize-link/` | URL summarization workflow        |
| `web-search/`     | Web search methodology            |
