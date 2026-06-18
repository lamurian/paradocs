---
name: web-search
description: Single source of truth for web search methodology — tier selection, category mapping, domain filtering, and fallback chain. Called by other skills that need to search the web.
---

# Web Search

Call this skill when you need to search the web for information. The skill handles tier selection, category routing, and fallback logic. Other skills (knowledge, research, roadmap) delegate their search steps here.

## Call interface

```
/skill:web-search "<query>"
/skill:web-search "<query>" tier=1
/skill:web-search "<query>" tier=2
/skill:web-search "<query>" tier=2 category=it
/skill:web-search "<query>" tier=3
```

- **tier** — 1 (academic), 2 (filtered web), 3 (general). Default: 1.
- **category** — override for tier 2. Supported values: `it` (tech/software), `news` (news), `web` (general filtered web).

## Tier logic

### Tier 1 — Academic (default)
- SearXNG category: `scientific_publications`
- Use for: academic papers, peer-reviewed research, scholarly sources
- The `web_search` tool uses `tier=1`.

### Tier 2 — Filtered web
- SearXNG category: `web` with `site:.edu OR site:.gov` domain filtering
- Override via `category` param:
  - `category=it` → SearXNG `it` category (tech/software)
  - `category=news` → SearXNG `news` category
  - `category=web` → default filtered web
- Use for: authoritative non-academic sources, documentation, news, software references

### Tier 3 — General
- SearXNG category: `general` (unrestricted)
- Use for: broad exploration, blogs, any web content

## Fallback chain

If SearXNG returns thin or no results:

1. **Tavily** — general web search fallback
2. **Bing RSS** — domain-filtered RSS fallback

The `web_search` tool handles this automatically. You do not need to implement fallback logic manually.

## Parameters passed to web_search tool

```
web_search(query: "<query>", tier: <1|2|3>)
web_search(query: "<query>", tier: 2, category: "<it|news|web>")
```

See the web-search extension documentation (`.pi/extensions/web-search/AGENTS.md`) for API details.

## What this skill does NOT do

- Does not interpret or synthesise results — returns raw search output
- Does not fetch full page content — use `fetch_url` for that
- Does not decide which tier to use — the calling skill chooses
