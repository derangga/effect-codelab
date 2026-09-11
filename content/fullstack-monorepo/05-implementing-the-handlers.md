---
title: Implementing the Handlers
order: 5
slug: 05-implementing-the-handlers
summary: HttpApiBuilder turns the declared API into a layer, and the compiler will not let you forget an endpoint.
draft: true
---

## The compiler holds the checklist

`HttpApiBuilder` asks for a handler per declared endpoint. Miss one and it is
a type error, not a 404 found in production.

## One handler

Payload already decoded, repo asked for by tag, success value returned as the
schema promised. Point out how little the handler does.

## Returning a declared failure

The endpoint said it can fail with a not-found. The handler fails with that
error and the status comes from the declaration, so nobody writes a status
code by hand.

## Layers, wired

The group layer, provided the repo layer, provided the sqlite client layer.
This is [Layers and Config](/learn/basic-effect/08-layers-and-config) with
more nodes and no new ideas.

## What is not here

No serialisation, no validation, no route matching. The declaration did those.

## Next

Point at Serving It, which is the last layer in the stack.
