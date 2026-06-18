---
title: SearXNG Search API Parameters
description: Reference for all supported SearXNG API parameters used by the web-search extension. Consumed by pi agent for constructing SearXNG queries.
author: pi
editor: lam
date: 2026-06-03T00:00:00.000Z
tags:
  - agent
  - search
  - api
source: https://docs.searxng.org/dev/search_api.html
---

# SearXNG Search API — Parameter Reference

The web-search extension queries a local SearXNG instance via Docker (port 8888) using HTTP GET requests. This document lists all supported API parameters as specified in the [SearXNG Search API](https://docs.searxng.org/dev/search_api.html) documentation.

## Endpoints

Both `/` and `/search` are supported for GET and POST. This extension uses `GET /search` with URL query parameters.

## Parameters

### `q` (required)

The search query string. Passed directly to external search services. Supports SearXNG search syntax such as `site:github.com`.

Example: `machine learning transformers`

### `categories` (optional)

Comma-separated list of active search categories. Controls which engine groups are queried. The extension uses these categories per tier:

| Tier | Default Category        | Description                               |
| ---- | ----------------------- | ----------------------------------------- |
| 1    | `scientific_publications` | Academic papers, preprints, research      |
| 2    | `web`                   | General web with `site:.edu OR site:.gov` |
| 3    | `general`               | Unrestricted web search                   |

Override with the `category` tool parameter when the question requires a specific category (`it`, `news`, `images`, etc.).

### `engines` (optional)

Comma-separated list of specific engines to query. Overrides `categories` when both are set. Example: `arxiv,pubmed,openalex`.

### `format` (optional, default: `json`)

Output format. Supported: `json`, `csv`, `rss`. This extension always uses `json`.

### `safesearch` (optional, default from `search:` in settings.yml)

Safe search level:
- `0` — off
- `1` — moderate (this extension default)
- `2` — strict

### `language` (optional, default from `search:` in settings.yml)

Language code for results. This extension uses `en`.

### `pageno` (optional, default: `1`)

Search result page number.

### `time_range` (optional)

Time range filter for engines that support it. Values: `day`, `month`, `year`.

### `results_on_new_tab` (optional, default: `0`)

Open search results in a new tab. Values: `0`, `1`.

### `image_proxy` (optional, default from `server:` in settings.yml)

Proxy image results through SearXNG. Values: `True`, `False`.

### `autocomplete` (optional, default from `search:` in settings.yml)

Autocomplete service. Values: `google`, `dbpedia`, `duckduckgo`, `mwmbl`, `startpage`, `wikipedia`, `swisscows`, `qwant`.

### `theme` (optional, default: `simple`)

Instance theme. Usually `simple`.

### `enabled_plugins` / `disabled_plugins` (optional)

Lists of plugins to enable or disable. Default enabled: `Hash_plugin`, `Self_Information`, `Tracker_URL_remover`, `Ahmia_blacklist`. Default disabled: `Hostnames_plugin`, `Open_Access_DOI_rewrite`, `Vim-like_hotkeys`, `Tor_check_plugin`.

### `enabled_engines` / `disabled_engines` (optional)

Lists of engines to explicitly enable or disable. Overrides the default set.

## Extension defaults

The web-search tool (`web_search`) abstracts these parameters behind a simpler interface:

- `query` (string, required) — mapped to `q`
- `tier` (1, 2, or 3, optional) — maps to `categories` as shown above
- `category` (string, optional) — overrides `categories` for the chosen tier

When `category` is provided, no query modification is applied. When `tier=2` with no custom category, the query is prefixed with `site:.edu OR site:.gov` for authoritative source filtering.

## Usage note for the agent

When calling `web_search`, the agent can influence tier 2 behavior via the `category` parameter:

- For technical software/IT questions, pass `category: "it"`
- For news queries, pass `category: "news"`
- For academic literature, use `tier: 1` (category is automatically `scientific_publications`)
- For general web results, use `tier: 3`
