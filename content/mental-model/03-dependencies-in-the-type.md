---
title: Dependencies Live in the Type
order: 3
slug: 03-dependencies-in-the-type
summary: An import is a dependency the type does not mention. The R channel is the same dependency written down where a caller can see it.
draft: true
---

## The habit: import the thing you need

A module importing its database client works, and hides what the function
needs from everyone reading its signature.

## What an import costs you at test time

To test the function you have to intercept the module. Mocking, injection
containers, and the rest of the machinery exist because the dependency was
never in the type.

## The third slot

`R` is the list of things this program needs before it can run. Show a
signature carrying one, and that the program cannot be run until it is
provided.

## Providing is a decision at the edge

The same shape as running: a program says what it needs, and one place decides
what to give it. Real is one choice, a stub is another, and the program cannot
tell.

## Why this is worth the type noise

Requirements you can see are requirements you can swap. Name the payoff and
stop.

## Next

Point at Unlearning try, catch and await, which puts the three channels
together against the keywords they replace.
