---
title: Eventual consistency and the reconciliation step
source-type: article
url: https://example.com/eventual-consistency
author: Peter Bailis
tags: [distributed-systems, systems, reconciliation, state]
status: read
created: 2026-02-14
---

## Summary

In an eventually consistent system, replicas are permitted to disagree
temporarily; correctness comes from a reconciliation function that deterministically
merges divergent states. The interesting engineering is never in the replication,
it is in choosing the merge.

## Notes
- The declared state and the observed state are different objects, and the system
  is defined by how it closes the gap.
- Last-write-wins is popular because it is cheap, not because it is right.
- Systems that treat divergence as an error rather than an input tend to fight
  their own users.

## Links
- [[desire-paths]]
