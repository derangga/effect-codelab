---
title: The Repo Over Sqlite
order: 4
slug: 04-the-repo-over-sqlite
summary: SqlClient behind a service boundary, SqlSchema to decode rows, and Migrator to get the table there in the first place.
draft: true
---

## Why a repo and not queries in handlers

The handler should say what it wants, not how the row is stored. This is the
service argument from [Services](/learn/basic-effect/06-services) applied to a
database.

## SqlClient

The tagged template for queries, and what it does about escaping. Note that it
is a service, so a handler asking for it says so in `R`.

The driver is the only new dependency the track needs, and it builds a layer
providing `SqlClient` to everything above it:

```ts twoslash
import { Schema } from 'effect'
import { SqliteClient } from '@effect/sql-sqlite-bun'

const Todo = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  done: Schema.Boolean,
})

const SqliteLive = SqliteClient.layer({ filename: 'todos.db' })
//    ^?
```

## Rows are foreign data

A row is `unknown` until something checks it. `SqlSchema` decodes it into the
`Todo` from `shared`, which means the boundary check happens here rather than
being assumed.

## Migrator

Where the table comes from. One migration for the todos table, and the reason
migrations are files rather than a `CREATE TABLE IF NOT EXISTS` at startup.

## The service the rest of the app sees

`TodoRepo` with four methods and no SQL in its type. Everything above this
line stops knowing there is a database.

## Next

Point at Implementing the Handlers, which is where the declaration and the
repo meet.
