---
title: Instrument the workaround, not the happy path
source-type: talk
url: https://example.com/telemetry-design
author: Kathy Sierra
tags: [design, telemetry, systems, product]
status: read
created: 2026-01-30
---

## Summary

Teams instrument the flows they intended people to use, so their dashboards
confirm the design rather than test it. The signal worth capturing is where
people deviate: the copy-paste, the spreadsheet export, the second browser tab.

## Notes
- A workaround is a fully specified feature request that nobody wrote down.
- Deviation data is expensive to collect and trivially valuable once you have it.
- Most orgs discover their real workflow years late, via a support ticket.

## Links
- [[desire-paths]]
- [[defaults-are-policy]]
