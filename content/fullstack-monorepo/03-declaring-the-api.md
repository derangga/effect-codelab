---
title: Declaring the API as a Value
order: 3
slug: 03-declaring-the-api
summary: HttpApiEndpoint, HttpApiGroup and HttpApi describe the whole surface as data, before a single handler exists.
draft: true
---

## A route table you can read

The habit being retired is describing routes by registering callbacks. Here
the description is a value, and the handlers come later.

## One endpoint

`HttpApiEndpoint` with a method, a path, the payload schema and the success
schema. Point out that the schemas are the ones from `shared`.

## Failures are declared too

An endpoint says which errors it can return and with what status. Same
argument as the `E` channel, one level up. Reference
[Errors](/learn/basic-effect/05-errors).

## Grouping and assembling

`HttpApiGroup` collects the todo endpoints, `HttpApi` collects the groups.
Show the type growing as each is added, since that type is what the client and
the tests will read.

## What the declaration already gives you

Before any implementation exists: the OpenAPI document, the client, and the
list of handlers the compiler will insist on. Name all three, implement none.

## Next

Point at The Repo Over Sqlite, since the handlers need somewhere to put a
todo.
