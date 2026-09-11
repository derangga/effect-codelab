---
title: Testing the API
order: 8
slug: 08-testing-the-api
summary: HttpApiTest runs the real handlers with no socket, and swapping the repo layer decides what the database is.
draft: true
---

## What is worth testing here

Not that the framework routes. That the handler makes the decision the
endpoint promised: the right failure, the right status, the right shape.
Same rule as [Testing](/learn/basic-effect/10-testing).

## HttpApiTest

Calls the API in process, no port and no socket. Show a test that posts a todo
and reads it back.

## Swapping the repo

The repo is a layer, so a test provides an in-memory one and the handlers do
not notice. This is the layer swap, one level up.

## When the real database is the point

A migration test wants real sqlite. Use a file per test rather than a shared
one, and say why the isolation matters more than the speed.

## Testing the declaration itself

A test that the client and the API agree is a test the compiler already ran.
Do not write it.

## Next

That is the track. Point back at [Anti-patterns](/learn/anti-patterns) for the
mistakes this material makes easy.
