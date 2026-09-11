---
title: The Workspace Shape
order: 1
slug: 01-the-workspace-shape
summary: Three packages, api, web and shared, and the one rule about which may import which.
draft: true
---

## The problem a single package has

Backend and frontend in one folder, or in two repositories that agree by
convention. Name what goes wrong in each: the shared type drifts, or the
rename lands on one side only.

## api, web, shared

What each one holds, in a sentence. `shared` holds schemas and nothing else,
which is the constraint that keeps it importable from both sides.

## The import rule

`api` and `web` both depend on `shared`. Neither depends on the other, and
`shared` depends on neither. Say why the rule matters more than the tooling
that enforces it.

## Wiring it with workspaces

The `package.json` fields that make `shared` resolvable by name. Keep this
short. It is the least interesting part and the most copied.

## What this buys

A field rename in `shared` fails the build in `api` and `web` at the same
time. That is the whole argument for one repository.

## Next

Point at The Todo in Schema, the first thing to put in `shared`.
