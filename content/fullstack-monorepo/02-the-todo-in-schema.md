---
title: The Todo in Schema
order: 2
slug: 02-the-todo-in-schema
summary: One Schema definition in shared, used as a type by the frontend and as a parser by the backend.
draft: true
---

## One definition, two jobs

A `Schema` is a type and a decoder at once. That is why it can live in
`shared` and satisfy both sides, where a bare `type` would satisfy neither at
runtime.

## Writing the Todo

The fields, and `Schema.Struct`. Derive the TypeScript type from the schema
rather than declaring it alongside, so the two cannot disagree.

## The shapes around it

A todo being created has no id yet, and a patch has every field optional. Show
that these are derived from the one definition, not written out again.

## Where decoding actually happens

At the boundary, once, on the way in. Inside, the type is trusted. Link back
to [Schema](/learn/basic-effect/06-schema) rather than reteaching it.

## What breaks on purpose

Rename a field here and watch both packages fail to compile. This is the
payoff the workspace was for.

## Next

Point at Declaring the API as a Value, which describes the endpoints that
carry these schemas.
