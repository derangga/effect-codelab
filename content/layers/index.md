---
title: Layers
order: 3
theme: foundations
level: intermediate
icon: Layers
prereq: Assumes the Basic Effect track
summary: Eight chapters on building and composing layers, from one hand written service to an app root where two repositories share a single database connection.
---

This track is about one question: you have written services, so how do they
actually get built, and who builds the things they depend on.

[Basic Effect](/learn/basic-effect) answered the short version of that in a
single chapter. It showed `Layer.effect`, one `Layer.provide`, and
`Layer.mergeAll`, which is enough to run a program with two services in it. It
is not enough the first time a third service shares a database connection with
the other two, or the first time a layer can fail while it is being built, or
the first time a test needs the real service with one dependency swapped out.

Those are the cases this track covers, and they are the cases where the
official [layers documentation](https://effect.website/docs/v4/requirements-management/layers)
starts listing functions faster than it explains when you would want them.
`provide`, `provideMerge`, `merge`, `mergeAll`, `fresh`, `tap`, `catchTag`,
`mock`, `launch`. Nine names, and the docs are right that they all exist. What
is missing is the shape of the problem each one answers.

## What we build

One small app, grown wire by wire. By the last chapter it is five services deep
and every operator above has appeared because the wiring needed it, not because
a list said so.

```
effect-feed/
├── .env              DATABASE_URL, FEED_SIZE
├── package.json
├── tsconfig.json
└── src/
    ├── database.ts   chapters 1, 3 and 6. Database, and the one connection
    ├── config.ts     chapter 2. AppConfig, read once from the environment
    ├── repos.ts      chapter 4. UserRepo and ArticleRepo, over that connection
    ├── feed.ts       chapter 5. FeedService, over both repositories
    └── main.ts       chapters 5, 7 and 8. The graph, and the line that runs it
```

Every code block names its file on the first line, like `// src/database.ts`,
so you always know where the code you are reading belongs. Where a block
continues or replaces something written earlier, the comment says so:
`// src/database.ts, replacing the declaration from chapter one`. Blocks that
carry no file name are either plain TypeScript with no Effect in them or a
fragment of a class that cannot stand alone, and both are labelled.

The snippets are compiled as the multi-file project you are building, not as
isolated examples, so an import that does not resolve or a type that does not
line up across two files fails this site's build rather than reaching you.

Two repositories over one connection is the smallest shape that makes the hard
parts visible. With one repository you never find out whether the connection is
opened once or twice, and that question is most of what separates people who
are comfortable with layers from people who are not.

This track is documentation. It describes a project rather than shipping one,
so nothing here is built inside this repository. Every terminal block quoted in
a chapter is copied from a real run of the five files above.

## Setting up a project

Nothing here needs a database driver, an HTTP server, or a test runner. The
`Database` service in this track logs instead of connecting, because the point
is the wiring around it rather than the SQL inside it. One package:

```sh
mkdir effect-feed
cd effect-feed
bun init -y
bun add --exact effect@4.0.0-rc.117
bun add -d --exact @effect/tsgo@0.45.0 typescript@6.0.3
```

`--exact` matters. Effect v4 is in release candidate, and a version range moves
the types out from under code that compiled yesterday.

In `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "plugins": [{ "name": "@effect/language-service" }]
  },
  "include": ["src"]
}
```

`strict` is the line that is not negotiable. Layers carry three type
parameters and almost every lesson in this track is read off one of them, so
without `strict` you are reading numbers that are not true.

Two environment variables, in `.env`:

```sh
DATABASE_URL=sqlite://feed.db
FEED_SIZE=20
```

Check the install works:

```ts twoslash
// src/main.ts
import { Effect } from 'effect'

const program = Effect.gen(function* () {
  yield* Effect.log('Effect is set up')
  return 1 + 1
})

Effect.runPromise(program).then(console.log)
```

Run it with `bun run src/main.ts`. A timestamped log line and then `2`.

## How the chapters work

Each chapter opens with a problem the previous chapter left behind, adds one
operator, and shows the mistake people make with it. Read them in order. The
app is cumulative, and chapter five cannot show you what memoization is worth
until chapter four has given it two repositories to share.

## Roadmap

1. [The wiring problem](/learn/layers/01-the-wiring-problem)
2. [Building a layer](/learn/layers/02-building-a-layer)
3. [Providing, and where the requirement goes](/learn/layers/03-providing)
4. [Standing side by side](/learn/layers/04-standing-side-by-side)
5. [One instance, or two](/learn/layers/05-one-instance)
6. [Layers that fail, layers that clean up](/learn/layers/06-failure-and-cleanup)
7. [Tapping a layer](/learn/layers/07-tapping)
8. [Swapping the graph](/learn/layers/08-swapping-the-graph)

## What this track leaves out

`Layer.build`, `Layer.buildWithScope`, `Layer.buildWithMemoMap` and
`Layer.fromBuild` are how you write a runtime, not how you use one. If you are
building a framework adapter, a worker pool, or something that hands a built
context to code outside Effect, they are the functions you want, and the
[API reference](https://effect.website/docs/v4/requirements-management/layers)
covers them.

`Layer.flatMap`, `Layer.unwrap` and `Layer.updateService` appear only in
passing. They build a layer whose shape is decided by a value computed at
startup. That is a real need, and it is rare enough that meeting it in chapter
two would cost more than it teaches.

`Layer.launch` is absent because this app has nothing to launch. It builds a
layer and holds it open until something interrupts it, instead of building it,
running a program and tearing it down, so it is what you want when the
application *is* the layer. A feed that answers one question and exits is not
that. The [HTTP Auth API](/learn/http-auth-api) track has a server that is.

## Where to go next

The habits that undo all of this are collected in the
[anti-patterns](/learn/anti-patterns) track, and
[Services and layers](/learn/anti-patterns/04-services-and-layers) is the one
that overlaps here. For layers wired into something real, the
[HTTP Auth API](/learn/http-auth-api) track builds a server whose entire
startup is one layer graph.
