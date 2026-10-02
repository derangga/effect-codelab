---
title: Concurrency
order: 5
theme: foundations
level: intermediate
icon: Workflow
prereq: Assumes the Basic Effect track
summary: Seven chapters that fetch nine products at once, limit how many run together, race a cache against the API, count results in a Ref, fix the count with a lock, guard a three-connection pool with a Semaphore and queue the writes.
---

The Basic Effect track fetches one product at a time. This track fetches nine,
and each chapter adds one tool for doing that without making a mess: how many
run at once, what happens to the ones still running when something finishes
or fails, how they share a counter, how they share a connection pool, and how
one side hands work to another.

It follows one thread from start to finish. Fetch nine products with a limit
on how many run together. Race a cache against the API. Count the results in a
`Ref`. Keep that count right with a lock. Guard a pool of three database
connections with a `Semaphore`. Queue
the writes so a slow database slows the fetching down instead of running out
of memory. Each chapter builds on the one before it.

Four chapters have a simulator inside the page. It runs the same Effect code
the chapter shows, with `Effect.sleep` standing in for the work, so you can
change a number and watch what happens.

## What you need

The [Basic Effect](/learn/basic-effect) track. You should be comfortable with
`Effect.gen`, `yield*` and running an effect with `Effect.runPromise`.

## What it leaves out

`PubSub`, `Deferred`, `Latch`, `Effect.forkDetach`, `Effect.forkScoped`,
`Effect.forkIn`, `FiberSet`, `PartitionedSemaphore`, `withPermitsIfAvailable`,
`Queue.sliding` and `Queue.dropping` all exist and are worth knowing about.
They solve narrower problems than the tools here, so they wait until you
have a problem that needs one.
