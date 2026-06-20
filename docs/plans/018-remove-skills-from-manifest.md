---
title: Remove Skills from Manifest
description: Remove skills/ from pi manifest and clean up references
status: {{status}}
date: 2026-06-20
---

# Overview

After tool descriptions are updated and commands are implemented, remove the skills/ directory from the pi manifest and clean up references. The skill content is preserved in tool descriptions and command handler output.

# Goals

- Remove skills/ from package.json pi.skills entry
- Update root AGENTS.md to remove the skills/ directory reference
- Update extensions/AGENTS.md if it references skills
- Update ARCHITECTURE.md if it references skills
- Skill files remain on disk (safe rollback), but pi no longer loads them

# Implementation Steps

- [ ] Edit package.json: remove the `"skills": ["./skills"]` line from the `pi` section
- [ ] Edit root AGENTS.md: remove or update the skills/ row in the package structure table
- [ ] Check and update ARCHITECTURE.md if it references skills (read the file first)
- [ ] Check and update extensions/AGENTS.md if it references skills (read the file first)
- [ ] Add a note in skills/README.md or similar explaining the files are inactive, or leave existing files as-is

# Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Omitting a file that still references skills | Low | Low | Check each file with grep first |
| User wants to revert | Low | Low | Skill files remain on disk, just re-add pi.skills entry |

# UAT

1. Run `pi /reload` then `/commands` — no /skill:* commands from paradocs should appear
2. Verify no skill references in critical paths

This plan implements @docs/specs/026-skill-directory-cleanup.md
