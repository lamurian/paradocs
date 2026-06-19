---
title: Update ARCHITECTURE.md with Link Format
description: Add the markdown link format standard to ARCHITECTURE.md for discoverability.
status: {{status}}
date: 2026-06-19
---

# Overview

Spec 017 defines the `[title](path.md)` markdown link format standard for PARA cross-references. The spec itself is already written. This plan captures the decision in ARCHITECTURE.md so future contributors can find it.

# Goals

- ARCHITECTURE.md includes a "Cross-Reference Format" section documenting the decision
- The link format is discoverable without reading ADR/Spec docs

# Implementation Steps

- [ ] Read ARCHITECTURE.md to identify where to add the section
- [ ] Add a "## Cross-Reference Format" section documenting the `[title](path.md)` format, title resolution from files table, and path conventions
- [ ] Verify the file is ≤100 lines per project conventions

# Risks

None — this is a documentation-only change.

# UAT

1. Open ARCHITECTURE.md
2. Confirm "Cross-Reference Format" section exists with correct format description
3. Confirm file is ≤100 lines

This plan implements @docs/specs/017-link-format-specification.md
