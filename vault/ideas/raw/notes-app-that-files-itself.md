---
title: A notes app that files itself
tags: [tooling, knowledge, agents]
status: seed
created: 2026-07-28
---

Capture is solved and filing is not. Every inbox I have ends up as a graveyard
because filing requires knowing the current state of the whole vault, which is
exactly the thing I have paged out by the time I capture something.

An agent with a shell could do it — read the ruleset, grep for near-duplicates,
decide append-vs-create, write the frontmatter. The hard part is that it needs
the *whole repo*, not an API.
