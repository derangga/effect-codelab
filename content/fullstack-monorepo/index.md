---
title: Fullstack Monorepo
order: 1
theme: applications
level: intermediate
icon: Server
prereq: Assumes the Basic Effect track
summary: A todo app with an Effect backend and an Effect frontend, sharing one schema across a workspace.
---

Basic Effect builds one service. This track builds a whole application around
it: an HTTP API declared as a value, a sqlite repo behind a service boundary, a
typed client the frontend calls without writing a single fetch, and a schema
that both sides import from the same file.

This track is documentation. It describes a workspace rather than shipping
one, so nothing here is built inside this repository.

The point of the workspace is that last part. When the todo type lives in one
place, renaming a field breaks the build on both sides at once, which is the
whole argument for doing this in one repository.

These modules are imported from `effect/unstable/http`,
`effect/unstable/httpapi` and `effect/unstable/sql`. They are in the effect
package itself, not a separate platform package, and the `unstable` in the path
is honest: they can change before 4.0 is final.
