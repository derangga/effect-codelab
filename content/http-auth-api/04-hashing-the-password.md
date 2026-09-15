---
title: Hashing the password
order: 4
slug: 04-hashing-the-password
summary: Why the password column never holds a password, the register handler, and the one piece of wiring that gives the empty 400 its body back.
---

The register handler receives a password and has to put something in the
`passwordHash` column. The one thing it must not put there is the password.

Databases get copied to laptops, printed into logs, and occasionally stolen. A
stolen table of passwords is an emergency for every other site those people
used the same password on. A stolen table of hashes is a bad day.

## Hash, and why that alone is not enough

A **hash** is a one way function. Feed it `Secret1` and you get a fixed string
back. Feed it `Secret1` again and you get the same string. There is no
practical way to run it backwards, so storing the hash lets you check a
password later without ever keeping the password.

The gap is that "the same input gives the same output" cuts both ways. If two
people pick `password123`, their rows match, and an attacker who works out one
has worked out both. Worse, they can work out a huge list of common passwords
once, in advance, and just look your hashes up.

A **salt** closes that. It is a chunk of random data mixed in before hashing,
different for every row, and stored alongside the hash. Now the same password
produces a different result for every user, and a precomputed list is worth
nothing.

## Bun does both

Bun ships password hashing in its runtime, and it is argon2id, which is a hash
deliberately designed to be slow and memory hungry so that guessing at scale is
expensive.

```ts twoslash
import { password } from 'bun'

const hashed = await password.hash('Secret1')
const ok = await password.verify('Secret1', hashed)
//    ^?
```

There is no salt argument, and no salt column in
[the user table](/learn/http-auth-api/03-the-user-table). Bun generates a fresh
salt per call and writes it into the output string, along with the algorithm
and its settings:

```
$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG
```

`verify` reads all of that back out of the stored string, which is why it needs
no salt argument either. So the design still salts every password. It just does
not make you hold it.

## Behind a service

Hashing goes in a service rather than being called directly, because argon2id
is slow on purpose and a test suite that hashes for real is one nobody runs.

```ts twoslash
// src/auth.ts
import { Context, Effect, Layer } from 'effect'
import { password } from 'bun'

export class PasswordHasher extends Context.Service<PasswordHasher>()(
  'PasswordHasher',
  {
    make: Effect.gen(function* () {
      const hash = (plain: string) => Effect.promise(() => password.hash(plain))

      const verify = (plain: string, hashed: string) =>
        Effect.promise(() => password.verify(plain, hashed))

      return { hash, verify } as const
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
```

`Effect.promise` is for a promise you have decided cannot meaningfully fail. If
hashing throws, the process is out of memory, which is not a thing the caller
can handle.

## The register handler

`src/handlers.ts` already exists, holding the three stubs from
[email and password](/learn/http-auth-api/02-email-and-password). Here is the
register one, written for real. Everything it imports was exported by the
chapter that made it.

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
// ---cut---
// src/handlers.ts, above the AuthHandlers chain
import { Effect, Option } from 'effect'
import { RegisterPayload, User } from './domain'
import { EmailAlreadyTaken } from './errors'
import { UserRepo } from './repo'
import { PasswordHasher } from './auth'

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
```

`register` takes the payload rather than being a bare Effect, because the
endpoint hands it one. `Effect.fn` names it, which puts that name on the
trace.

The body is four steps and no decisions. The payload arrived validated, the
status codes live on the schemas, and nothing here mentions 201 or 409.

The second argument to `Effect.fn` sorts the failures, and it is there because
the body fails in ways the endpoint never declared: a `SqlError` from either
repository call, a schema issue from building the row. A caller can act on
neither, so one failure stays a failure and the rest become defects, which is a
500 and a log line rather than a 409 blaming an email address for a broken
disk.

That 500 arrives with no body.
[Me and the public user](/learn/http-auth-api/07-me-and-the-public-user) gives
it one.

## Attaching it to the endpoint

`HttpApiBuilder.group` connects a handler to the endpoint declared at the start
of the track. `handlers.ts` already has an `AuthHandlers`, so this replaces it
rather than sitting below it: two in one file is a duplicate declaration, and
keeping the old one leaves `register` a stub that dies with `register is not
written yet`.

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
// @filename: src/api.ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/unstable/httpapi'
import {
  LoginPayload,
  LoginResult,
  RegisterPayload,
  User,
} from './domain'
import { EmailAlreadyTaken, InvalidCredentials } from './errors'

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

export const AuthApi = HttpApi.make('AuthApi').add(
  HttpApiGroup.make('auth').add(register, login, me),
)
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
// ---cut---
// src/handlers.ts, replacing the AuthHandlers that held three stubs
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { AuthApi } from './api'

export const AuthHandlers = HttpApiBuilder.group(AuthApi, 'auth', (handlers) =>
  handlers
    .handle('register', ({ payload }) => register(payload))
    .handle('login', () => Effect.die('login is not written yet'))
    .handle('me', () => Effect.die('me is not written yet')),
)
```

`'register'` is the endpoint name, not the path. The compiler checks it exists,
that what you return matches the success schema, and that `register` cannot
fail in a way the endpoint did not declare. Leave the transform out and this
line stops compiling.

`login` and `me` keep their stubs for now, and get real handlers in
[signing the token](/learn/http-auth-api/05-signing-the-token) and
[me and the public user](/learn/http-auth-api/07-me-and-the-public-user).

The handler asks for the hasher, so `main.ts` has to hand it over.

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
// @filename: src/api.ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/unstable/httpapi'
import {
  LoginPayload,
  LoginResult,
  RegisterPayload,
  User,
} from './domain'
import { EmailAlreadyTaken, InvalidCredentials } from './errors'

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

export const AuthApi = HttpApi.make('AuthApi').add(
  HttpApiGroup.make('auth').add(register, login, me),
)
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

export const AuthHandlers = HttpApiBuilder.group(AuthApi, 'auth', (handlers) =>
  handlers
    .handle('register', ({ payload }) => register(payload))
    .handle('login', () => Effect.die('login is not written yet'))
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
import { PasswordHasher } from './auth'

const SqlLive = SqliteClient.layer({ filename: 'auth.db' })
// ---cut---
// src/main.ts, the hasher added
const ApiLive = HttpApiBuilder.layer(AuthApi).pipe(
  Layer.provide(AuthHandlers),
  HttpRouter.provideRequest(
    Layer.mergeAll(UserRepo.layer, PasswordHasher.layer).pipe(
      Layer.provide(SqlLive),
    ),
  ),
)
```

`PasswordHasher.layer` joins the repository behind `provideRequest`, because a
handler is what wants it.

Registering works:

```sh
curl -i -X POST 127.0.0.1:3000/register \
  -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com","password":"Secret1"}'
```

```
HTTP/1.1 201 Created
{"id":"01a09ec8-ebe4-778e-916a-e09205d04a03","name":"Ada",
 "email":"ada@example.com","createdAt":"2026-09-14T07:19:22.855Z"}
```

Note what is not in that body. Nobody removed it, and
[Me and the public user](/learn/http-auth-api/07-me-and-the-public-user)
explains why it was never there.

Send the same email twice and the second one is a 409, which leaks something:
anyone can discover whether an address has an account here by trying to
register it. You cannot both reject duplicate signups and hide who is
registered, so this is a trade rather than a bug. Know you made it.

## Giving the 400 its body back

[Email and password](/learn/http-auth-api/02-email-and-password) left the
caller with zero bytes. Here is why: every request that fails to decode
produces the same shared empty response, and the messages go to the log. There
is no setting to change that, and no option to make the decoder report every
failure rather than the first.

There is one hook. A middleware can catch the decoding failure before it
becomes a response, which lets you answer it yourself.

```ts twoslash
import { Schema } from 'effect'
// ---cut---
// src/errors.ts
export class ValidationFailed extends Schema.TaggedError<ValidationFailed>()(
  'ValidationFailed',
  {
    issues: Schema.Array(
      Schema.Struct({ path: Schema.String, message: Schema.String }),
    ),
  },
  { httpApiStatus: 400 },
) {}
```

```ts twoslash
// @filename: src/errors.ts
import { Schema } from 'effect'

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
// ---cut---
// src/api.ts
import { HttpApiMiddleware } from 'effect/unstable/httpapi'
import { ValidationFailed } from './errors'

export class ErrorHandler extends HttpApiMiddleware.Service<ErrorHandler>()(
  'ErrorHandler',
  { error: ValidationFailed },
) {}
```

The error goes in `errors.ts` with the rest, and the middleware declaration in
`api.ts` next to the endpoints, for the same reason
[the middleware](/learn/http-auth-api/06-the-middleware) puts `Authorization`
there: a 400 with messages is part of what a client is promised.

The implementation goes in `auth.ts`, and
`HttpApiMiddleware.layerSchemaErrorTransform` exists for exactly this. It hands
you the decoding failure and takes whatever you want to fail with instead.

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
// ---cut---
// src/auth.ts, below the PasswordHasher service
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
```

`schemaError.cause.issue` is the value
[email and password](/learn/http-auth-api/02-email-and-password) formatted by
hand, so the same formatter does the job.

`ErrorHandler` goes on the API rather than on `register`, so login gets it for
nothing, and `ErrorHandlerLayer` goes into `main.ts` with plain
`Layer.provide`, because middleware belongs to the API, not to a request.

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

export const AuthHandlers = HttpApiBuilder.group(AuthApi, 'auth', (handlers) =>
  handlers
    .handle('register', ({ payload }) => register(payload))
    .handle('login', () => Effect.die('login is not written yet'))
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
import { ErrorHandlerLayer, PasswordHasher } from './auth'

const SqlLive = SqliteClient.layer({ filename: 'auth.db' })
// ---cut---
// src/main.ts, and the error handler
const ApiLive = HttpApiBuilder.layer(AuthApi).pipe(
  Layer.provide(AuthHandlers),
  Layer.provide(ErrorHandlerLayer),
  HttpRouter.provideRequest(
    Layer.mergeAll(UserRepo.layer, PasswordHasher.layer).pipe(
      Layer.provide(SqlLive),
    ),
  ),
)
```

The same request now answers:

```
HTTP/1.1 400 Bad Request
Content-Type: application/json

{"_tag":"ValidationFailed","issues":[
  {"path":"email","message":"Not a valid email"}]}
```

One issue, not four. `{ errors: 'all' }` still returns all of them when you
decode a value yourself, but the framework calls the decoder with no options,
so it stops at the first field that fails. Getting every rule out of an
endpoint means reading the body again and decoding it again inside this
transform.

Still, the caller went from zero bytes to a field and a reason, which is the
difference between a form that can point at the problem and one that cannot. A
missing field arrives the same way, as `Missing key` at the path that was
absent.

## What people get wrong

Treating that middleware as a pattern to copy elsewhere. It works around a gap
in a release candidate, and it is written once, in one file, so the day the
option exists it is one function to delete.

## Next

An account exists, and there is still no way to prove you own it.
[Signing the token](/learn/http-auth-api/05-signing-the-token) issues one at
login, keeps the signing secret out of every log line, and refuses to say
whether it was the email or the password you got wrong.
