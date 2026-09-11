---
title: Serving It
order: 6
slug: 06-serving-it
summary: An HttpServer layer at the bottom, the API layer on top, and HttpApiSwagger for a page you can click.
draft: true
---

## The server is a layer too

Nothing special about the bottom of the stack. Show the whole program as one
layer graph and run it in one call.

## Choosing a platform

The node server layer, and the port. Keep this brief. It is the one part that
is not portable and the one part nobody rereads.

## HttpApiSwagger

The OpenAPI document falls out of the declaration, so the documentation page
is a layer you add rather than a file you maintain. Note it can go behind a
flag for production.

## Graceful shutdown

Interruption reaching the server layer means connections close and the
database handle is released, without a shutdown hook. A short note, since it
is a consequence of scope rather than a feature.

## The whole main file

Every layer in one place, and the point that this is the only file that knows
the real world exists.

## Next

Point at The Typed Client, which is the same declaration read from the other
side.
