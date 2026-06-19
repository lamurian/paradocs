# Skills

7 skills (SKILL.md) that orchestrate knowledge workflows by chaining tools from extensions.

| Skill            | Dependencies                              | Purpose                                        |
|------------------|-------------------------------------------|------------------------------------------------|
| `knowledge`      | search, read, brainstorm, web-search...   | Q&A workflow over PARA docs                    |
| `create-doc`     | list_para_tags, resolve_citation...       | Single source of truth for doc creation        |
| `web-search`     | web_search                                | Tier selection, category mapping               |
| `summarize-link` | find_existing_summary, fetch_url...       | URL → summarize → create-doc → auto-link       |
| `brainstorm`     | (pure LLM)                                | Clarify vague questions via structured dialogue|
| `auto-link`      | search_para_docs, read, update_para_doc   | [[wikilink]] after note creation               |
| `research`       | web-search, fetch_url, brainstorm...      | Iterative academic research pipeline           |

## Conventions

- Each skill is a directory with `SKILL.md` (frontmatter + markdown body).
- Frontmatter includes name, description, and tool dependencies.
- Skills reference tools by their registered name (e.g., `search_para_docs`).
