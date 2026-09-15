---
title: Email and password
order: 2
slug: 02-email-and-password
summary: Three password rules as three separate checks with three messages, reported all at once, and the surprise waiting when you wire them to an endpoint.
---

The rules are ordinary. A password must be at least six characters, contain an
uppercase letter, and contain a number. Here is how that usually gets written.

```js
const ok = /^(?=.*[A-Z])(?=.*[0-9]).{6,}$/.test(password)
if (!ok) throw new Error('Password is not strong enough')
```

It works, and it is miserable to be on the other end of. Somebody types
`banana`, gets that sentence, adds a capital B, gets the same sentence, adds a
number, and finally gets in. Three round trips, and at no point did the service
say which rule was broken. The regex knows. It just has no way to tell anyone.

This chapter fixes that, and then discovers something worse.

## A check is a condition with a message

Start with one rule. A **check** is a condition attached to a schema, and the
schema will not accept a value that fails it.

```ts twoslash
import { Schema } from 'effect'

const Password = Schema.String.pipe(
  Schema.check(Schema.isMinLength(6, { message: 'Password must be at least 6 characters' })),
)
```

`Schema.String` is the base. `Schema.check` narrows it. The second argument to
`isMinLength` is where the message lives, and that message travels with the
rule rather than being written at the place the rule is tested.

That last part is why this beats the regex. The condition and the explanation
are one thing, so they cannot drift apart.

## Three rules, three messages

`Schema.check` takes as many checks as you give it.

```ts twoslash
// src/domain.ts
import { Schema } from 'effect'

export const Password = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(6, { message: 'Password must be at least 6 characters' }),
    Schema.isPattern(/[A-Z]/, { message: 'Password must contain an uppercase letter' }),
    Schema.isPattern(/[0-9]/, { message: 'Password must contain a digit' }),
  ),
)
```

Three rules, three sentences, each one able to name itself. Now to get them
out.

## Reading the failure

Checking a value is an Effect, because it can fail.
`Schema.decodeUnknownEffect` turns a schema into a function that takes anything
and either gives you a validated value or fails.

```ts twoslash
import { Effect, Schema, SchemaIssue } from 'effect'

const Password = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(6, { message: 'Password must be at least 6 characters' }),
    Schema.isPattern(/[A-Z]/, { message: 'Password must contain an uppercase letter' }),
    Schema.isPattern(/[0-9]/, { message: 'Password must contain a digit' }),
  ),
)
// ---cut---
const decode = Schema.decodeUnknownEffect(Password)
const format = SchemaIssue.makeFormatterDefault()

const program = decode('banana').pipe(
  Effect.catchTag('SchemaError', (error) =>
    Effect.log(format(error.issue)),
  ),
)
```

Run that and one line comes out:

```
Password must contain an uppercase letter
```

One. Not three. The password is also missing a digit, and nothing said so,
which puts us back where the regex left us.

## Asking for all of them

Decoding stops at the first failure because that is the default. Ask for the
other behaviour and you get it.

```ts twoslash
import { Effect, Schema, SchemaIssue } from 'effect'

const Password = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(6, { message: 'Password must be at least 6 characters' }),
    Schema.isPattern(/[A-Z]/, { message: 'Password must contain an uppercase letter' }),
    Schema.isPattern(/[0-9]/, { message: 'Password must contain a digit' }),
  ),
)
// ---cut---
const decodeAll = Schema.decodeUnknownEffect(Password, { errors: 'all' })
const format = SchemaIssue.makeFormatterStandardSchemaV1()

const program = decodeAll('abc').pipe(
  Effect.catchTag('SchemaError', (error) =>
    Effect.log(format(error.issue).issues.map((issue) => issue.message)),
  ),
)
```

Now all three arrive together:

```
[ "Password must be at least 6 characters",
  "Password must contain an uppercase letter",
  "Password must contain a digit" ]
```

One round trip instead of three. That is the whole argument for three checks
over one regex, and `{ errors: 'all' }` is the line that unlocks it.

Two details will bite you here. The failure is a `SchemaError`, and the
formatter wants the `issue` inside it, not the error itself. And each issue's
`path` is an array of keys rather than a string, so `['password']` and not
`'password'`, which matters as soon as you are validating a whole object rather
than one field.

## Email, and what a brand is

Email gets a check too, plus one extra thing.

```ts twoslash
// src/domain.ts
import { Schema } from 'effect'

export const Email = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'Not a valid email' }),
  ),
  Schema.brand('Email'),
)

export type Email = typeof Email.Type
//          ^?
```

A **brand** is a marker that makes a type distinct from the type it is built
on. `Email` is still a string at runtime, but TypeScript will no longer accept
any old string where an `Email` is wanted. A function taking `(email: Email,
name: string)` cannot be called with its arguments the wrong way round, which
is a mistake that otherwise typechecks perfectly and ruins somebody's evening.

The next chapter needs this brand for a different reason, so it is worth adding
now.

## Now wire it up

Three things have to happen before a request can reach any of these checks. The
payload has to use them, somebody has to answer the endpoint, and a server has
to be listening.

The payload is one word per field, in `src/domain.ts`:

```ts twoslash
import { Schema } from 'effect'

const Password = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(6, { message: 'Password must be at least 6 characters' }),
    Schema.isPattern(/[A-Z]/, { message: 'Password must contain an uppercase letter' }),
    Schema.isPattern(/[0-9]/, { message: 'Password must contain a digit' }),
  ),
)

const Email = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'Not a valid email' }),
  ),
  Schema.brand('Email'),
)
// ---cut---
// src/domain.ts, replacing the plain strings from the last chapter
export const RegisterPayload = Schema.Struct({
  name: Schema.String,
  email: Email,
  password: Password,
})

export const LoginPayload = Schema.Struct({
  email: Email,
  password: Schema.String,
})
```

`LoginPayload` keeps a plain string on purpose. Logging in is checking a
password, not choosing one, and an account made before the rules tightened
still has to be able to get in.

Next, `src/handlers.ts`, which is a new file. A group will not build while any
endpoint in it is unanswered, and none of the three can be answered yet, so all
three say so out loud.

```ts twoslash
// @filename: src/domain.ts
import { Schema } from 'effect'

export const RegisterPayload = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  password: Schema.String,
})
export type RegisterPayload = typeof RegisterPayload.Type

export const PublicUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
})

export const LoginPayload = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
})
export type LoginPayload = typeof LoginPayload.Type

export const LoginResult = Schema.Struct({ token: Schema.String })
// @filename: src/errors.ts
import { Schema } from 'effect'

export class EmailAlreadyTaken extends Schema.TaggedError<EmailAlreadyTaken>()(
  'EmailAlreadyTaken',
  { email: Schema.String },
  { httpApiStatus: 409 },
) {}

export class InvalidCredentials extends Schema.TaggedError<InvalidCredentials>()(
  'InvalidCredentials',
  {},
  { httpApiStatus: 401 },
) {}
// @filename: src/api.ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/unstable/httpapi'
import { LoginPayload, LoginResult, PublicUser, RegisterPayload } from './domain'
import { EmailAlreadyTaken, InvalidCredentials } from './errors'

export const register = HttpApiEndpoint.post('register', '/register', {
  payload: RegisterPayload,
  success: PublicUser.pipe(HttpApiSchema.status(201)),
  error: EmailAlreadyTaken,
})

export const login = HttpApiEndpoint.post('login', '/login', {
  payload: LoginPayload,
  success: LoginResult,
  error: InvalidCredentials,
})

export const me = HttpApiEndpoint.get('me', '/me', { success: PublicUser })

export const authGroup = HttpApiGroup.make('auth').add(register, login, me)

export const AuthApi = HttpApi.make('AuthApi').add(authGroup)
// @filename: src/handlers.ts
// ---cut---
// src/handlers.ts
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { AuthApi } from './api'

export const AuthHandlers = HttpApiBuilder.group(AuthApi, 'auth', (handlers) =>
  handlers
    .handle('register', () => Effect.die('register is not written yet'))
    .handle('login', () => Effect.die('login is not written yet'))
    .handle('me', () => Effect.die('me is not written yet')),
)
```

`Effect.die` crashes on purpose. These three lines get replaced one at a time,
starting in
[hashing the password](/learn/http-auth-api/04-hashing-the-password), which is
also where `HttpApiBuilder.group` gets explained. They are here so that there
is something to run.

Last, the server. `src/main.ts` still holds the `1 + 1` from the setup steps.
Replace the whole file:

```ts twoslash
// @filename: src/domain.ts
import { Schema } from 'effect'

export const RegisterPayload = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  password: Schema.String,
})
export type RegisterPayload = typeof RegisterPayload.Type

export const PublicUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
})

export const LoginPayload = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
})
export type LoginPayload = typeof LoginPayload.Type

export const LoginResult = Schema.Struct({ token: Schema.String })
// @filename: src/errors.ts
import { Schema } from 'effect'

export class EmailAlreadyTaken extends Schema.TaggedError<EmailAlreadyTaken>()(
  'EmailAlreadyTaken',
  { email: Schema.String },
  { httpApiStatus: 409 },
) {}

export class InvalidCredentials extends Schema.TaggedError<InvalidCredentials>()(
  'InvalidCredentials',
  {},
  { httpApiStatus: 401 },
) {}
// @filename: src/api.ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/unstable/httpapi'
import { LoginPayload, LoginResult, PublicUser, RegisterPayload } from './domain'
import { EmailAlreadyTaken, InvalidCredentials } from './errors'

export const register = HttpApiEndpoint.post('register', '/register', {
  payload: RegisterPayload,
  success: PublicUser.pipe(HttpApiSchema.status(201)),
  error: EmailAlreadyTaken,
})

export const login = HttpApiEndpoint.post('login', '/login', {
  payload: LoginPayload,
  success: LoginResult,
  error: InvalidCredentials,
})

export const me = HttpApiEndpoint.get('me', '/me', { success: PublicUser })

export const authGroup = HttpApiGroup.make('auth').add(register, login, me)

export const AuthApi = HttpApi.make('AuthApi').add(authGroup)
// @filename: src/handlers.ts
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { AuthApi } from './api'

export const AuthHandlers = HttpApiBuilder.group(AuthApi, 'auth', (handlers) =>
  handlers
    .handle('register', () => Effect.die('register is not written yet'))
    .handle('login', () => Effect.die('login is not written yet'))
    .handle('me', () => Effect.die('me is not written yet')),
)
// @filename: src/main.ts
// ---cut---
// src/main.ts
import { Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { BunHttpServer, BunRuntime } from '@effect/platform-bun'
import { AuthApi } from './api'
import { AuthHandlers } from './handlers'

const ApiLive = HttpApiBuilder.layer(AuthApi).pipe(Layer.provide(AuthHandlers))

const ServerLive = HttpRouter.serve(ApiLive).pipe(
  Layer.provide(BunHttpServer.layer({ port: 3000, hostname: '127.0.0.1' })),
)

BunRuntime.runMain(Layer.launch(ServerLive))
```

Every value in that file is a **layer**, which is Effect's word for a recipe
that builds one piece of the running program. Two of them for now:
`HttpApiBuilder.layer` puts the handlers behind the API declaration, and
`BunHttpServer.layer` is the server they run on.
[Me and the public user](/learn/http-auth-api/07-me-and-the-public-user) reads
the finished version of this file line by line, and explains why the hostname
is spelled out rather than left to Bun.

Start it:

```sh
bun run --watch src/main.ts
```

```
INFO (#2): Listening on http://127.0.0.1:3000
```

`--watch` restarts on save, and leaving it running is how the rest of the track
assumes you are working.

If something already holds port 3000, you get this instead and the process
stops:

```
ERROR (#2): Error: Failed to start server. Is port 3000 in use?
```

Stopping is right. A server that cannot listen has nothing useful to do, so a
refused port arrives as a **defect**, the same category as the `Effect.die` in
the stubs: a failure nothing is meant to catch.
[Typed errors](/learn/basic-effect/03-typed-errors) draws that line. Stop
whatever holds the port, or change the number in `main.ts`. The usual culprit
is a `--watch` left running in another tab.

## What the caller gets

Send it something bad.

```sh
curl -i -X POST 127.0.0.1:3000/register \
  -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"nope","password":"abc"}'
```

Here is the entire response.

```
HTTP/1.1 400 Bad Request
Date: Mon, 14 Sep 2026 07:12:42 GMT
Content-Length: 0

```

There is no body. Not a shortened body, not a generic message: zero bytes, no
content type, nothing. The four sentences we just built exist, and the caller
receives none of them.

They went to the server log instead, and only the first one:

```
HttpApiSchemaError: Payload {
  [cause]: SchemaError: Not a valid email
    at ["email"]
}
```

It gets worse. Send a request that leaves `password` out entirely and the
response is byte for byte identical. A caller cannot tell a rule they broke
from a field they forgot.

## What people get wrong

Assuming the messages come out because they went in. They are real, they are
correct, and by default they reach a log file that the person filling in your
signup form cannot read. Writing good validation messages and never checking
what a client receives is the mistake, and it is easy to make because
everything looks right from the inside.

The fix is not more schemas. It is a single piece of wiring, applied once for
the whole API, and it belongs next to a running endpoint rather than here.

## Next

[The user table](/learn/http-auth-api/03-the-user-table) puts these two
schemas into a sqlite table and gets a repository over it, and
[Hashing the password](/learn/http-auth-api/04-hashing-the-password) is where
the empty 400 gets its body back.
