---
title: The Typed Client
order: 7
slug: 07-the-typed-client
summary: HttpApiClient derives the frontend's calls from the same declaration, so no one writes a fetch or a URL.
draft: true
---

## The duplication this removes

The usual frontend has a hand-written function per endpoint, each repeating a
path, a method and a response type that the backend already stated. All three
can be wrong independently.

## Deriving the client

`HttpApiClient` takes the `HttpApi` value and gives back a typed method per
endpoint. Show that the argument and return types are the `shared` schemas,
not `any`.

## Errors arrive typed

A declared failure comes back in the `E` channel, so the frontend handles it
the way it handles any other Effect failure.

## Reaching React

`ManagedRuntime` bridges Effect and component state, the same way `/demo` on
this site does. Point at that page rather than rebuilding the explanation.

## What a rename does now

Change a field in `shared` and the failure lands in the frontend at compile
time. Close the loop opened in chapter one.

## Next

Point at Testing the API, the last chapter.
