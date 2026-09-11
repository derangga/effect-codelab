---
title: Failure is a Value
order: 2
slug: 02-failure-is-a-value
summary: throw hides what can go wrong from the type. Effect puts it in the signature, and the compiler starts helping.
draft: true
---

## The habit: throw for anything that goes wrong

Why `throw` is invisible. A function that throws has the same type as one that
cannot, so nothing tells a caller which is which.

## try and catch catch too much

Catching gives you `unknown`. Show what a reader has to already know to write
the catch block correctly, and that nothing checks the guess.

## The second slot in the type

`Effect<A, E, R>` and what `E` is for. One failure, named, visible in the
signature.

## Expected failures against defects

The line to draw: a failure the program plans for goes in `E`, a broken
assumption is a defect and should crash. Keep this short. It is the
distinction that makes the rest of the track make sense.

## The compiler starts helping

An unhandled failure becomes a type error at the call site. Show that this is
the whole return on the extra ceremony.

## Next

Point at Dependencies Live in the Type, the third slot.
