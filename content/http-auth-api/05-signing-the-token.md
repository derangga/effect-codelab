---
title: Signing the token
order: 5
slug: 05-signing-the-token
summary: A signing secret that cannot end up in a log line, a one hour token from jose, and a login that refuses to say which half you got wrong.
---

Registering is done. Now somebody logs in, and the next request they make has
to prove it was them.

Sending the email and password again on every request means the browser has to
keep them, which is the thing we spent the last chapter avoiding. Keeping a
list of who is logged in works, and costs a database read on every single
request forever.

The third option is to hand the caller a note that says who they are, in
handwriting only the server can produce. The caller keeps the note and shows it
each time. The server does not remember issuing it. It just recognises its own
handwriting.

## What a token actually is

A **JSON Web Token** is three pieces of text joined by dots.

```
eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMWEwOWVjOCJ9.QRl3sK5B4h2xN0pT7wZ
```

The first says which algorithm signed it. The second holds the **claims**, the
facts being asserted, such as who this is and when it stops being valid. Both
are ordinary base64, so anyone can read them. Nothing in a token is secret.

The third is the signature, and it is the entire point. It is computed from the
first two plus a secret only the server knows. Change one character of the
claims and the signature no longer matches. So a token cannot be forged or
edited, even though it can be read.

That last part decides what goes in it. Claims are public, so a token carries
an id and an expiry, never a password and never anything private.

## The secret, and keeping it out of logs

The secret is the only thing standing between an attacker and a valid token for
any account they like. It comes from the environment, never from the source.

```ts twoslash
import { Config, Effect, Redacted } from 'effect'

const program = Effect.gen(function* () {
  const secret = yield* Config.Redacted('JWT_SECRET')
  //    ^?
  return Redacted.value(secret).length
})
```

Two things happen there. `Config.Redacted` reads the variable and puts the
failure to find it into the type, so an app started without `JWT_SECRET`
refuses to boot rather than signing everything with `undefined`.

And the value is wrapped in a **Redacted**, which is a box that will not print
what is inside it.

```ts twoslash
import { Redacted } from 'effect'

const secret = Redacted.make('hunter2')

console.log(String(secret)) // <redacted>
console.log(JSON.stringify({ secret })) // {"secret":"<redacted>"}
```

Log the whole config object, put it in an error report, hand it to a crash
reporter, and the secret does not travel. Getting at it takes
`Redacted.value`, which is deliberately something you have to type.

## Issuing one

`jose` does the signing. Nothing in Effect does JSON Web Tokens, and this is
not a thing to write yourself: the interesting bugs are in the verifying, and
they are silent.

```ts twoslash
// src/auth.ts
import { Config, Context, Effect, Layer, Redacted } from 'effect'
import { SignJWT, jwtVerify } from 'jose'

export class Tokens extends Context.Service<Tokens>()('Tokens', {
  make: Effect.gen(function* () {
    const secret = yield* Config.Redacted('JWT_SECRET')
    const key = new TextEncoder().encode(Redacted.value(secret))

    const issue = (userId: string) =>
      Effect.promise(() =>
        new SignJWT({})
          .setProtectedHeader({ alg: 'HS256' })
          .setSubject(userId)
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(key),
      )

    const verify = (token: string) => Effect.tryPromise(() => jwtVerify(token, key))

    return { issue, verify } as const
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
```

`issue` and `verify` wrap their promises differently, and the difference is the
whole point of the pair. Signing with a key you already hold does not fail, so
`Effect.promise` is right. Verifying fails constantly and on purpose, every
time somebody sends a token that was edited, expired or made up, so it gets
`Effect.tryPromise`, which turns a rejected promise into a failure the caller
can catch. Use `Effect.promise` there and a bad token crashes the request into
a 500 instead of the 401 it deserves.

`HS256` signs with one shared secret, which is right here because one service
both issues and checks. Algorithms with a key pair exist so that somebody else
can verify without being able to sign, and there is no somebody else yet.

Three claims and no more. `setSubject` is the user id, `setIssuedAt` is when,
and `setExpirationTime('1h')` is how long. The name is deliberately absent:
[Me and the public user](/learn/http-auth-api/07-me-and-the-public-user) reads
it from the database instead, so a rename shows up immediately rather than an
hour later.

## Logging in

```ts twoslash
// @filename: src/domain.ts
import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const UserId = Schema.String.pipe(Schema.brand('UserId'))

export const Email = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'Not a valid email' }),
  ),
  Schema.brand('Email'),
)

export const Password = Schema.String.pipe(
  Schema.check(Schema.isMinLength(6, { message: 'Too short' })),
)

export const RegisterPayload = Schema.Struct({
  name: Schema.String,
  email: Email,
  password: Password,
})
export type RegisterPayload = typeof RegisterPayload.Type

export const LoginPayload = Schema.Struct({
  email: Email,
  password: Schema.String,
})
export type LoginPayload = typeof LoginPayload.Type

export const LoginResult = Schema.Struct({ token: Schema.String })

export class User extends Model.Class<User>('User')({
  id: Model.UuidV7Insert(UserId),
  name: Schema.String,
  email: Email,
  passwordHash: Model.Sensitive(Schema.String),
  createdAt: Model.DateTimeInsert,
}) {}
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

export class ValidationFailed extends Schema.TaggedError<ValidationFailed>()(
  'ValidationFailed',
  {
    issues: Schema.Array(
      Schema.Struct({ path: Schema.String, message: Schema.String }),
    ),
  },
  { httpApiStatus: 400 },
) {}
// @filename: src/repo.ts
import { Context, Effect, Layer } from 'effect'
import { SqlClient, SqlModel, SqlSchema } from 'effect/unstable/sql'
import { Email, User } from './domain'

export class UserRepo extends Context.Service<UserRepo>()('UserRepo', {
  make: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const repository = yield* SqlModel.makeRepository(User, {
      tableName: 'users',
      spanPrefix: 'UserRepo',
      idColumn: 'id',
    })
    const findByEmail = SqlSchema.findOneOption({
      Request: Email,
      Result: User,
      execute: (email) => sql`SELECT * FROM users WHERE email = ${email}`,
    })
    return { ...repository, findByEmail } as const
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
// @filename: src/auth.ts
import { Config, Context, Effect, Layer, Redacted, Schema } from 'effect'
import { password } from 'bun'
import { SignJWT, jwtVerify } from 'jose'
import { UserId } from './domain'

export class PasswordHasher extends Context.Service<PasswordHasher>()('PasswordHasher', {
  make: Effect.sync(() => ({
    hash: (plain: string) => Effect.promise(() => password.hash(plain)),
    verify: (plain: string, hashed: string) =>
      Effect.promise(() => password.verify(plain, hashed)),
  })),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

export class Tokens extends Context.Service<Tokens>()('Tokens', {
  make: Effect.gen(function* () {
    const secret = yield* Config.Redacted('JWT_SECRET')
    const key = new TextEncoder().encode(Redacted.value(secret))

    const issue = (userId: string) =>
      Effect.promise(() =>
        new SignJWT({})
          .setProtectedHeader({ alg: 'HS256' })
          .setSubject(userId)
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(key),
      )

    const verify = (token: string) => Effect.tryPromise(() => jwtVerify(token, key))

    return { issue, verify } as const
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
// @filename: src/handlers.ts
import { Effect, Option } from 'effect'
import { RegisterPayload, User } from './domain'
import { EmailAlreadyTaken } from './errors'
import { UserRepo } from './repo'
import { PasswordHasher } from './auth'
// ---cut---
// src/handlers.ts, beside register
import { LoginPayload } from './domain'
import { InvalidCredentials } from './errors'
import { Tokens } from './auth'

export const login = Effect.fn('login')(
  function* (payload: LoginPayload) {
    const users = yield* UserRepo
    const hasher = yield* PasswordHasher
    const tokens = yield* Tokens

    const found = yield* users.findByEmail(payload.email)
    if (Option.isNone(found)) {
      return yield* new InvalidCredentials()
    }

    const matches = yield* hasher.verify(payload.password, found.value.passwordHash)
    if (!matches) {
      return yield* new InvalidCredentials()
    }

    return { token: yield* tokens.issue(found.value.id) }
  },
  Effect.catch((error) =>
    error instanceof InvalidCredentials ? Effect.fail(error) : Effect.die(error),
  ),
)
```

Same shape as
[the register handler](/learn/http-auth-api/04-hashing-the-password): a
function of the payload, and a transform that keeps the one failure a caller
can act on and turns the rest into defects.

Look at the two failure branches. An email nobody has registered and a wrong
password produce the identical error, and therefore the identical 401.

That is on purpose. Different answers would let anyone check whether an address
has an account here by watching which one they get back.
[Hashing the password](/learn/http-auth-api/04-hashing-the-password) already
gave that away at the register endpoint, and the fact that one endpoint leaks
is not a reason to hand it over twice.

## Attaching it

The chain in `handlers.ts` still answers `login` with a stub, so it gets
replaced, the same way the last chapter replaced the one that stubbed
`register`.

```ts twoslash
// @filename: src/domain.ts
import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const UserId = Schema.String.pipe(Schema.brand('UserId'))

export const Email = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'Not a valid email' }),
  ),
  Schema.brand('Email'),
)

export const Password = Schema.String.pipe(
  Schema.check(Schema.isMinLength(6, { message: 'Too short' })),
)

export const RegisterPayload = Schema.Struct({
  name: Schema.String,
  email: Email,
  password: Password,
})
export type RegisterPayload = typeof RegisterPayload.Type

export const LoginPayload = Schema.Struct({
  email: Email,
  password: Schema.String,
})
export type LoginPayload = typeof LoginPayload.Type

export const LoginResult = Schema.Struct({ token: Schema.String })

export class User extends Model.Class<User>('User')({
  id: Model.UuidV7Insert(UserId),
  name: Schema.String,
  email: Email,
  passwordHash: Model.Sensitive(Schema.String),
  createdAt: Model.DateTimeInsert,
}) {}
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

export class ValidationFailed extends Schema.TaggedError<ValidationFailed>()(
  'ValidationFailed',
  {
    issues: Schema.Array(
      Schema.Struct({ path: Schema.String, message: Schema.String }),
    ),
  },
  { httpApiStatus: 400 },
) {}
// @filename: src/api.ts
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from 'effect/unstable/httpapi'
import {
  LoginPayload,
  LoginResult,
  RegisterPayload,
  User,
} from './domain'
import { EmailAlreadyTaken, InvalidCredentials, ValidationFailed } from './errors'

export const register = HttpApiEndpoint.post('register', '/register', {
  payload: RegisterPayload,
  success: User.json.pipe(HttpApiSchema.status(201)),
  error: EmailAlreadyTaken,
})

export const login = HttpApiEndpoint.post('login', '/login', {
  payload: LoginPayload,
  success: LoginResult,
  error: InvalidCredentials,
})

export const me = HttpApiEndpoint.get('me', '/me', { success: User.json })

export class ErrorHandler extends HttpApiMiddleware.Service<ErrorHandler>()(
  'ErrorHandler',
  { error: ValidationFailed },
) {}

export const AuthApi = HttpApi.make('AuthApi')
  .add(HttpApiGroup.make('auth').add(register, login, me))
  .middleware(ErrorHandler)
// @filename: src/repo.ts
import { Context, Effect, Layer } from 'effect'
import { SqlClient, SqlModel, SqlSchema } from 'effect/unstable/sql'
import { Email, User } from './domain'

export class UserRepo extends Context.Service<UserRepo>()('UserRepo', {
  make: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const repository = yield* SqlModel.makeRepository(User, {
      tableName: 'users',
      spanPrefix: 'UserRepo',
      idColumn: 'id',
    })
    const findByEmail = SqlSchema.findOneOption({
      Request: Email,
      Result: User,
      execute: (email) => sql`SELECT * FROM users WHERE email = ${email}`,
    })
    return { ...repository, findByEmail } as const
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
// @filename: src/auth.ts
import { Config, Context, Effect, Layer, Redacted, Schema } from 'effect'
import { password } from 'bun'
import { SignJWT, jwtVerify } from 'jose'
import { UserId } from './domain'

export class PasswordHasher extends Context.Service<PasswordHasher>()('PasswordHasher', {
  make: Effect.sync(() => ({
    hash: (plain: string) => Effect.promise(() => password.hash(plain)),
    verify: (plain: string, hashed: string) =>
      Effect.promise(() => password.verify(plain, hashed)),
  })),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

export class Tokens extends Context.Service<Tokens>()('Tokens', {
  make: Effect.gen(function* () {
    const secret = yield* Config.Redacted('JWT_SECRET')
    const key = new TextEncoder().encode(Redacted.value(secret))

    const issue = (userId: string) =>
      Effect.promise(() =>
        new SignJWT({})
          .setProtectedHeader({ alg: 'HS256' })
          .setSubject(userId)
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(key),
      )

    const verify = (token: string) => Effect.tryPromise(() => jwtVerify(token, key))

    return { issue, verify } as const
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

import { SchemaIssue } from 'effect'
import { HttpApiMiddleware } from 'effect/unstable/httpapi'
import { ErrorHandler } from './api'
import { ValidationFailed } from './errors'

const format = SchemaIssue.makeFormatterStandardSchemaV1()

export const ErrorHandlerLayer = HttpApiMiddleware.layerSchemaErrorTransform(
  ErrorHandler,
  (schemaError) =>
    Effect.fail(
      new ValidationFailed({
        issues: format(schemaError.cause.issue).issues.map((issue) => ({
          path: (issue.path ?? []).join('.'),
          message: issue.message,
        })),
      }),
    ),
)
// @filename: src/handlers.ts
import { Effect, Option } from 'effect'
import { RegisterPayload, User } from './domain'
import { EmailAlreadyTaken } from './errors'
import { UserRepo } from './repo'
import { PasswordHasher } from './auth'
import { LoginPayload } from './domain'
import { InvalidCredentials } from './errors'
import { Tokens } from './auth'

export const register = Effect.fn('register')(
  function* (payload: RegisterPayload) {
    const users = yield* UserRepo
    const hasher = yield* PasswordHasher

    const existing = yield* users.findByEmail(payload.email)
    if (Option.isSome(existing)) {
      return yield* new EmailAlreadyTaken({ email: payload.email })
    }

    const passwordHash = yield* hasher.hash(payload.password)

    const row = yield* User.insert.makeEffect({
      name: payload.name,
      email: payload.email,
      passwordHash,
    })

    return yield* users.insert(row)
  },
  Effect.catch((error) =>
    error instanceof EmailAlreadyTaken ? Effect.fail(error) : Effect.die(error),
  ),
)

export const login = Effect.fn('login')(
  function* (payload: LoginPayload) {
    const users = yield* UserRepo
    const hasher = yield* PasswordHasher
    const tokens = yield* Tokens

    const found = yield* users.findByEmail(payload.email)
    if (Option.isNone(found)) {
      return yield* new InvalidCredentials()
    }

    const matches = yield* hasher.verify(payload.password, found.value.passwordHash)
    if (!matches) {
      return yield* new InvalidCredentials()
    }

    return { token: yield* tokens.issue(found.value.id) }
  },
  Effect.catch((error) =>
    error instanceof InvalidCredentials ? Effect.fail(error) : Effect.die(error),
  ),
)
// ---cut---
// src/handlers.ts, replacing the AuthHandlers that still stubs login
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { AuthApi } from './api'

export const AuthHandlers = HttpApiBuilder.group(AuthApi, 'auth', (handlers) =>
  handlers
    .handle('register', ({ payload }) => register(payload))
    .handle('login', ({ payload }) => login(payload))
    .handle('me', () => Effect.die('me is not written yet')),
)
```

`me` is the last one left, and
[me and the public user](/learn/http-auth-api/07-me-and-the-public-user) fills
it in.

`Tokens` then joins the other two services in `main.ts`, because a handler is
what asks for it.

```ts twoslash
// @filename: src/domain.ts
import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const UserId = Schema.String.pipe(Schema.brand('UserId'))

export const Email = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'Not a valid email' }),
  ),
  Schema.brand('Email'),
)

export const Password = Schema.String.pipe(
  Schema.check(Schema.isMinLength(6, { message: 'Too short' })),
)

export const RegisterPayload = Schema.Struct({
  name: Schema.String,
  email: Email,
  password: Password,
})
export type RegisterPayload = typeof RegisterPayload.Type

export const LoginPayload = Schema.Struct({
  email: Email,
  password: Schema.String,
})
export type LoginPayload = typeof LoginPayload.Type

export const LoginResult = Schema.Struct({ token: Schema.String })

export class User extends Model.Class<User>('User')({
  id: Model.UuidV7Insert(UserId),
  name: Schema.String,
  email: Email,
  passwordHash: Model.Sensitive(Schema.String),
  createdAt: Model.DateTimeInsert,
}) {}
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

export class ValidationFailed extends Schema.TaggedError<ValidationFailed>()(
  'ValidationFailed',
  {
    issues: Schema.Array(
      Schema.Struct({ path: Schema.String, message: Schema.String }),
    ),
  },
  { httpApiStatus: 400 },
) {}
// @filename: src/api.ts
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from 'effect/unstable/httpapi'
import {
  LoginPayload,
  LoginResult,
  RegisterPayload,
  User,
} from './domain'
import { EmailAlreadyTaken, InvalidCredentials, ValidationFailed } from './errors'

export const register = HttpApiEndpoint.post('register', '/register', {
  payload: RegisterPayload,
  success: User.json.pipe(HttpApiSchema.status(201)),
  error: EmailAlreadyTaken,
})

export const login = HttpApiEndpoint.post('login', '/login', {
  payload: LoginPayload,
  success: LoginResult,
  error: InvalidCredentials,
})

export const me = HttpApiEndpoint.get('me', '/me', { success: User.json })

export class ErrorHandler extends HttpApiMiddleware.Service<ErrorHandler>()(
  'ErrorHandler',
  { error: ValidationFailed },
) {}

export const AuthApi = HttpApi.make('AuthApi')
  .add(HttpApiGroup.make('auth').add(register, login, me))
  .middleware(ErrorHandler)
// @filename: src/repo.ts
import { Context, Effect, Layer } from 'effect'
import { SqlClient, SqlModel, SqlSchema } from 'effect/unstable/sql'
import { Email, User } from './domain'

export class UserRepo extends Context.Service<UserRepo>()('UserRepo', {
  make: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const repository = yield* SqlModel.makeRepository(User, {
      tableName: 'users',
      spanPrefix: 'UserRepo',
      idColumn: 'id',
    })
    const findByEmail = SqlSchema.findOneOption({
      Request: Email,
      Result: User,
      execute: (email) => sql`SELECT * FROM users WHERE email = ${email}`,
    })
    return { ...repository, findByEmail } as const
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
// @filename: src/auth.ts
import { Config, Context, Effect, Layer, Redacted, Schema } from 'effect'
import { password } from 'bun'
import { SignJWT, jwtVerify } from 'jose'
import { UserId } from './domain'

export class PasswordHasher extends Context.Service<PasswordHasher>()('PasswordHasher', {
  make: Effect.sync(() => ({
    hash: (plain: string) => Effect.promise(() => password.hash(plain)),
    verify: (plain: string, hashed: string) =>
      Effect.promise(() => password.verify(plain, hashed)),
  })),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

export class Tokens extends Context.Service<Tokens>()('Tokens', {
  make: Effect.gen(function* () {
    const secret = yield* Config.Redacted('JWT_SECRET')
    const key = new TextEncoder().encode(Redacted.value(secret))

    const issue = (userId: string) =>
      Effect.promise(() =>
        new SignJWT({})
          .setProtectedHeader({ alg: 'HS256' })
          .setSubject(userId)
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(key),
      )

    const verify = (token: string) => Effect.tryPromise(() => jwtVerify(token, key))

    return { issue, verify } as const
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

import { SchemaIssue } from 'effect'
import { HttpApiMiddleware } from 'effect/unstable/httpapi'
import { ErrorHandler } from './api'
import { ValidationFailed } from './errors'

const format = SchemaIssue.makeFormatterStandardSchemaV1()

export const ErrorHandlerLayer = HttpApiMiddleware.layerSchemaErrorTransform(
  ErrorHandler,
  (schemaError) =>
    Effect.fail(
      new ValidationFailed({
        issues: format(schemaError.cause.issue).issues.map((issue) => ({
          path: (issue.path ?? []).join('.'),
          message: issue.message,
        })),
      }),
    ),
)
// @filename: src/handlers.ts
import { Effect, Option } from 'effect'
import { RegisterPayload, User } from './domain'
import { EmailAlreadyTaken } from './errors'
import { UserRepo } from './repo'
import { PasswordHasher } from './auth'
import { LoginPayload } from './domain'
import { InvalidCredentials } from './errors'
import { Tokens } from './auth'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { AuthApi } from './api'

export const register = Effect.fn('register')(
  function* (payload: RegisterPayload) {
    const users = yield* UserRepo
    const hasher = yield* PasswordHasher

    const existing = yield* users.findByEmail(payload.email)
    if (Option.isSome(existing)) {
      return yield* new EmailAlreadyTaken({ email: payload.email })
    }

    const passwordHash = yield* hasher.hash(payload.password)

    const row = yield* User.insert.makeEffect({
      name: payload.name,
      email: payload.email,
      passwordHash,
    })

    return yield* users.insert(row)
  },
  Effect.catch((error) =>
    error instanceof EmailAlreadyTaken ? Effect.fail(error) : Effect.die(error),
  ),
)

export const login = Effect.fn('login')(
  function* (payload: LoginPayload) {
    const users = yield* UserRepo
    const hasher = yield* PasswordHasher
    const tokens = yield* Tokens

    const found = yield* users.findByEmail(payload.email)
    if (Option.isNone(found)) {
      return yield* new InvalidCredentials()
    }

    const matches = yield* hasher.verify(payload.password, found.value.passwordHash)
    if (!matches) {
      return yield* new InvalidCredentials()
    }

    return { token: yield* tokens.issue(found.value.id) }
  },
  Effect.catch((error) =>
    error instanceof InvalidCredentials ? Effect.fail(error) : Effect.die(error),
  ),
)

export const AuthHandlers = HttpApiBuilder.group(AuthApi, 'auth', (handlers) =>
  handlers
    .handle('register', ({ payload }) => register(payload))
    .handle('login', ({ payload }) => login(payload))
    .handle('me', () => Effect.die('me is not written yet')),
)
// @filename: src/main.ts
import { Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { BunHttpServer, BunRuntime } from '@effect/platform-bun'
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { AuthApi } from './api'
import { AuthHandlers } from './handlers'
import { UserRepo } from './repo'
import { ErrorHandlerLayer, PasswordHasher, Tokens } from './auth'

const SqlLive = SqliteClient.layer({ filename: 'auth.db' })
// ---cut---
// src/main.ts, one more on the same line
const ApiLive = HttpApiBuilder.layer(AuthApi).pipe(
  Layer.provide(AuthHandlers),
  Layer.provide(ErrorHandlerLayer),
  HttpRouter.provideRequest(
    Layer.mergeAll(UserRepo.layer, PasswordHasher.layer, Tokens.layer).pipe(
      Layer.provide(SqlLive),
    ),
  ),
)
```

```sh
curl -s -X POST 127.0.0.1:3000/login \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"Secret1"}'
```

```
{"token":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMWEwOWVjOCIsImlhdCI6MTc..."}
```

## What people get wrong

Being consistent about `Redacted` and putting it in the response schema too. It
looks right. It compiles.

```ts twoslash
import { Effect, Redacted, Schema } from 'effect'

const LoginResult = Schema.Struct({ token: Schema.Redacted(Schema.String) })

const encode = Schema.encodeUnknownEffect(LoginResult)
const body = encode({ token: Redacted.make('eyJhbGciOiJIUzI1NiJ9...') })
```

Run it and the response body is `{"token":"<redacted>"}`. Every client is now
broken, and the bug reads as a backend that issues the same token to everyone.

`Redacted` protects a value from leaving by accident. A token in a login
response is leaving on purpose, and that is the whole job of the endpoint. Send
a plain string.

The direction that does deserve one is inbound, and the next chapter gets that
for free.

## Next

Tokens are being handed out and nothing checks them yet.
[The middleware](/learn/http-auth-api/06-the-middleware) verifies the signature
and the expiry once, in one place, and hands the endpoints behind it a caller
they can trust.
