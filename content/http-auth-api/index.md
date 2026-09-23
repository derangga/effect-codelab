---
title: HTTP Auth API
order: 1
theme: applications
level: intermediate
icon: Shield
prereq: Assumes the Basic Effect track
summary: Eight chapters that build a register, login and user profile backend on sqlite, with validated input, hashed passwords, and a jwt gated endpoint.
---

This track builds a small backend with three endpoints. `POST /register`
creates an account. `POST /login` returns a token. `GET /me` returns the
signed-in user, and refuses anyone without a valid token.

Three endpoints is enough, because they cover the concerns every real service
has: input you cannot trust, a secret you must not leak, a password you must
never store as written, and a rule about who is allowed in. The database is
sqlite, which is a single file and needs nothing running.

This track is documentation. It describes a project rather than shipping one,
so nothing here is built inside this repository. Every code block is compiled
when this site builds, so an example that does not typecheck fails the build
instead of reaching you.

The HTTP and SQL modules come from `effect/unstable/http`,
`effect/unstable/httpapi` and `effect/unstable/sql`. They are in the `effect`
package itself rather than a separate one, and that word in the middle of every
import is the first thing most people notice about them.

## What "unstable" means here

The word stops people reaching for these modules, and it should not, because it
is a statement about the API rather than about the code. Michael Arnaldi, who
maintains Effect, put it plainly:

> That said as for anything in Effect unstable means the api might change, not
> that it's not ready for prod

![A post by Michael Arnaldi reading: That said as for anything in Effect unstable means the api might change, not that it's not ready for prod](/images/effect-unstable-reason.webp)

[The post](https://x.com/MichaelArnaldi/status/2090043454193639661), 19 August
2026.

So the thing to plan for is a rename, not a rewrite. A later release may move a
function or change an argument, and the compiler will tell you exactly where.
Nothing in this track is a prototype or a preview of a real implementation
arriving later: it is the implementation, and the reservation is about what it
will be called.

That is also why every version below is pinned exactly. Upgrading should be
something you sit down and do, not something that happens to you halfway
through a chapter.

## Setting up a project

These steps assume [Bun](https://bun.sh), which this track needs for two
things: the sqlite driver, and the password hashing built into its runtime.

### 1. Create the project

```sh
mkdir effect-auth-api
cd effect-auth-api
bun init -y
```

### 2. Install the packages

Every `effect` and `@effect/*` package shares one version number, and they must
match exactly. Mixing them is not a warning, it is a type error somewhere
confusing.

```sh
bun add --exact effect@4.0.0-rc.117
bun add --exact @effect/platform-bun@4.0.0-rc.117
bun add --exact @effect/sql-sqlite-bun@4.0.0-rc.117
bun add --exact jose@6.2.12
bun add -d --exact @effect/tsgo@0.45.0 typescript@6.0.3
```

`--exact` matters. Effect v4 is in release candidate, and a version range moves
the types out from under code that compiled yesterday.

`jose` is the only dependency here that is not Effect or Bun. It signs and
verifies the token in
[Signing the token](/learn/http-auth-api/05-signing-the-token). Nothing in
Effect does JSON Web Tokens, and this is not a thing to write yourself.

### 3. Turn on strict mode

Effect works out what your code can fail with and what it depends on by reading
the types. Without `strict` those conclusions are wrong in ways that are hard
to spot. In `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun"],
    "plugins": [{ "name": "@effect/language-service" }]
  },
  "include": ["src"]
}
```

`strict` is the line that is not negotiable. The plugin is the Effect language
service, installed above as `@effect/tsgo`, and it catches Effect-specific
mistakes TypeScript alone cannot see. Point your editor at the workspace
TypeScript or it will not load: in VS Code, run
`TypeScript: Select TypeScript Version` and choose `Use Workspace Version`.

### 4. Set the signing secret

The app reads one environment variable, and refuses to start without it. Put it
in `.env`:

```sh
JWT_SECRET=change-me-to-something-long-and-random
```

[Signing the token](/learn/http-auth-api/05-signing-the-token) explains why it
is read the way it is, and why it never reaches a log line.

### 5. Check it works

Put this in `src/main.ts`:

```ts twoslash
import { Effect } from 'effect'

const program = Effect.gen(function* () {
  yield* Effect.log('Effect is set up')
  return 1 + 1
})

Effect.runPromise(program).then(console.log)
```

Run it with `bun run src/main.ts`. You should see a timestamped log line and
then `2`.

## The shape of the project

Everything you write goes in seven files under `src`. You do not need to create
them now. Each one appears in the chapter that first needs it, and every code
block names its file on the first line, like `// src/domain.ts`, so you always
know where the code you are reading belongs.

```
effect-auth-api/
├── .env              JWT_SECRET, and nothing else
├── package.json
├── tsconfig.json
└── src/
    ├── domain.ts     schemas and branded types
    ├── errors.ts     every failure the service can answer with, and its status
    ├── api.ts        the HttpApi value: endpoints, groups, middleware declarations
    ├── repo.ts       UserRepo, the only file in the project that writes SQL
    ├── auth.ts       hashing, tokens, and the middleware implementations
    ├── handlers.ts   one function per endpoint
    └── main.ts       the layer graph, and the line that starts the server
```

The split is deliberate rather than tidiness, and two pairs are worth noticing
before you start.

`api.ts` holds what a client would be allowed to know, and `auth.ts` holds what
only the server may ever see. That is why the middleware is declared in one and
implemented in the other:
[the middleware](/learn/http-auth-api/06-the-middleware) makes the case, and
the short version is that the file holding your signing secret should never be
importable by a frontend.

`repo.ts` is the only file that writes SQL, and `handlers.ts` is the only file
that answers requests. Neither knows how the other works, so replacing sqlite
touches one file and no handler.

`errors.ts` is the odd one out, grouped by kind rather than by job. Failures
spread across the files that raise them is five places to look when you want to
know what a caller can receive. In one file it is a list you read in ten
seconds, with every status the service returns visible at once.

## How the chapters work

Each chapter opens with a problem, builds one idea, and shows the mistake
people make with it.

Read them in order.
[Email and password](/learn/http-auth-api/02-email-and-password) ends on a
problem that
[hashing the password](/learn/http-auth-api/04-hashing-the-password) solves, and
that is deliberate rather than an oversight.

## Roadmap

1. [The API as a value](/learn/http-auth-api/01-the-api-as-a-value)
2. [Email and password](/learn/http-auth-api/02-email-and-password)
3. [The user table](/learn/http-auth-api/03-the-user-table)
4. [Hashing the password](/learn/http-auth-api/04-hashing-the-password)
5. [Signing the token](/learn/http-auth-api/05-signing-the-token)
6. [The middleware](/learn/http-auth-api/06-the-middleware)
7. [Me and the public user](/learn/http-auth-api/07-me-and-the-public-user)
8. [Bonus: API docs with Scalar](/learn/http-auth-api/08-bonus-scalar)

## What this track leaves out

Real authentication is bigger than three endpoints, and the omissions are worth
naming so you know what you still have to think about.

**Refresh tokens and logout.** A token here lives an hour and then stops
working. Ending a session early means keeping a list of revoked tokens, which
is a database design question rather than an Effect one.

**Password reset and email verification.** Both need to send mail, which makes
them a chapter about a mail provider.

**Rate limiting on login.** Without it, the 401 from a failed login is an
invitation to guess passwords all day. It belongs in front of the endpoint, as
a middleware of the same shape as the one that gates `/me`.

**CORS and roles.** Both are one layer and one check respectively, and neither
teaches anything the rest of the track does not.

None of these are Effect problems. You would solve them the same way in any
framework, and the reason they are absent is length, not difficulty.

## Where to go next

If you want the same HTTP modules used to build a frontend as well as a
backend, with a client derived from the API rather than hand written, that is
the [Fullstack Monorepo](/learn/fullstack-monorepo) track. If you want the
habits that undo all of this, the [anti-patterns](/learn/anti-patterns) track
collects them.
