---
title: You Describe, You Don't Do
order: 1
slug: 01-you-describe
summary: A Promise has already started. An Effect has not, and that one difference is where most of the library comes from.
draft: true
---

## The habit: calling a function means the work starts

Where this comes from in ordinary TypeScript, and why it feels like the only
possible arrangement.

## What a Promise commits you to

A Promise is running by the time you hold it. Show the consequences that
follow from that: no retry without wrapping, no timeout without racing, no
inspecting what it will do before it does it.

## An Effect is a value that describes work

The same program as a description. Nothing has happened yet. Emphasise that
this is not laziness for its own sake.

## What you get back for the inconvenience

Retry, timeout, interruption and testing all become things you can do to a
value. Point at each without teaching it here.

## Running it, on purpose, at one place

`Effect.runPromise` at the edge, once. The habit to build is that running is a
separate decision from describing.

## Next

Point at Failure is a Value, which is the same move applied to the things that
go wrong.
