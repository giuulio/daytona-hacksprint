---
title: Why coding agents need real isolation
source-type: article
url: https://example.com/agent-sandboxing
author: Simon Willison
tags: [agents, security, sandboxing, tooling]
status: read
created: 2026-07-05
---

## Summary

An agent that reads untrusted text and then executes code is a prompt-injection
target by construction. The mitigation is not a better prompt, it is an execution
boundary: a disposable machine with no credentials worth stealing.

## Notes
- *No captured highlight — this note predates highlight capture.*
  - *"Untrusted input producing executable output" is the actual threat model.*
  - *Disposability matters more than hardening — a sandbox you rebuild per task has no persistence for an attacker to use.*

## Links
- [[context-engineering-for-agents]]
