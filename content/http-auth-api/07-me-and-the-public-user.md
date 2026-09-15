---
title: Me and the public user
order: 7
slug: 07-me-and-the-public-user
summary: A response shape that has no password hash to leak, a deleted user handled honestly, and the whole application stacked into one graph and started.
---

The row that comes out of the database has a password hash in it. The response
that goes to the browser must not. In most codebases the only thing between
those two sentences is a person remembering, usually by writing a second type
and keeping it in step by hand.

[The user table](/learn/http-auth-api/03-the-user-table) already removed that
job. `User.json` is the same declaration with the sensitive fields taken out,
derived rather than maintained.

## The response schema

```ts twoslash
import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

const UserId = Schema.String.pipe(Schema.brand('UserId'))
const Email = Schema.String.pipe(Schema.brand('Email'))

class User extends Model.Class<User>('User')({
  id: Model.UuidV7Insert(UserId),
  name: Schema.String,
  email: Email,
  passwordHash: Model.Sensitive(Schema.String),
  createdAt: Model.DateTimeInsert,
}) {}
// ---cut---
type UserJson = typeof User.json.Type
//   ^?
```

That is not a copy of `User` with a field deleted. It is `User`, viewed through
the rule that `Model.Sensitive` fields are not for JSON. Add a `phone` column
next year and it appears here. Mark it sensitive and it never does.

It is already the endpoint's success schema, since
[the user table](/learn/http-auth-api/03-the-user-table) swapped `PublicUser`
out for it, so the guarantee reaches the wire with no change to make:

```ts
// src/api.ts, already written, shown for the success field
export const me = HttpApiEndpoint.get('me', '/me', {
  success: User.json,
}).middleware(Authorization)
```

## The handler

The middleware has already established who is asking, so the handler is two
lines and a decision.

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

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  'Unauthorized',
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}
// @filename: src/api.ts
import { Context } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
} from 'effect/unstable/httpapi'
import {
  LoginPayload,
  LoginResult,
  RegisterPayload,
  User,
  UserId,
} from './domain'
import {
  EmailAlreadyTaken,
  InvalidCredentials,
  Unauthorized,
  ValidationFailed,
} from './errors'

export class CurrentUser extends Context.Service<
  CurrentUser,
  { readonly userId: typeof UserId.Type }
>()('CurrentUser') {}

export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentUser; requires: never }
>()('Authorization', {
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}

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

export const me = HttpApiEndpoint.get('me', '/me', {
  success: User.json,
}).middleware(Authorization)

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

import { Authorization, CurrentUser } from './api'
import { Unauthorized } from './errors'

export const AuthorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const tokens = yield* Tokens

    const verifyToken = Effect.fn('verifyToken')(
      function* (token: string) {
        const result = yield* tokens.verify(token)
        return yield* Schema.decodeUnknownEffect(UserId)(result.payload.sub)
      },
      Effect.catch(() => new Unauthorized({ message: 'Invalid token' })),
    )

    return Authorization.of({
      bearer: Effect.fn(function* (httpEffect, { credential }) {
        const userId = yield* verifyToken(Redacted.value(credential))

        return yield* Effect.provideService(httpEffect, CurrentUser, { userId })
      }),
    })
  }),
)
// @filename: src/handlers.ts
import { Effect } from 'effect'
import { UserRepo } from './repo'
// ---cut---
// src/handlers.ts, beside the other two
import { CurrentUser } from './api'
import { Unauthorized } from './errors'

export const me = Effect.gen(function* () {
  const { userId } = yield* CurrentUser
  const users = yield* UserRepo

  return yield* users.findById(userId)
}).pipe(
  Effect.catchTag('NoSuchElementError', () =>
    Effect.fail(new Unauthorized({ message: 'Invalid token' })),
  ),
  Effect.catch((error) =>
    error instanceof Unauthorized ? Effect.fail(error) : Effect.die(error),
  ),
)
```

`me` takes no argument, unlike the other two, because `/me` has no payload. The
one thing it needs comes from `CurrentUser`, which the middleware attached.

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

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  'Unauthorized',
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}
// @filename: src/api.ts
import { Context } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
} from 'effect/unstable/httpapi'
import {
  LoginPayload,
  LoginResult,
  RegisterPayload,
  User,
  UserId,
} from './domain'
import {
  EmailAlreadyTaken,
  InvalidCredentials,
  Unauthorized,
  ValidationFailed,
} from './errors'

export class CurrentUser extends Context.Service<
  CurrentUser,
  { readonly userId: typeof UserId.Type }
>()('CurrentUser') {}

export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentUser; requires: never }
>()('Authorization', {
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}

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

export const me = HttpApiEndpoint.get('me', '/me', {
  success: User.json,
}).middleware(Authorization)

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

import { Authorization, CurrentUser } from './api'
import { Unauthorized } from './errors'

export const AuthorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const tokens = yield* Tokens

    const verifyToken = Effect.fn('verifyToken')(
      function* (token: string) {
        const result = yield* tokens.verify(token)
        return yield* Schema.decodeUnknownEffect(UserId)(result.payload.sub)
      },
      Effect.catch(() => new Unauthorized({ message: 'Invalid token' })),
    )

    return Authorization.of({
      bearer: Effect.fn(function* (httpEffect, { credential }) {
        const userId = yield* verifyToken(Redacted.value(credential))

        return yield* Effect.provideService(httpEffect, CurrentUser, { userId })
      }),
    })
  }),
)
// @filename: src/handlers.ts
import { Effect, Option } from 'effect'
import { RegisterPayload, User } from './domain'
import { EmailAlreadyTaken } from './errors'
import { UserRepo } from './repo'
import { PasswordHasher } from './auth'
import { LoginPayload } from './domain'
import { InvalidCredentials, Unauthorized } from './errors'
import { CurrentUser } from './api'
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

export const me = Effect.gen(function* () {
  const { userId } = yield* CurrentUser
  const users = yield* UserRepo

  return yield* users.findById(userId)
}).pipe(
  Effect.catchTag('NoSuchElementError', () =>
    Effect.fail(new Unauthorized({ message: 'Invalid token' })),
  ),
  Effect.catch((error) =>
    error instanceof Unauthorized ? Effect.fail(error) : Effect.die(error),
  ),
)
// ---cut---
// src/handlers.ts, the chain with all three filled in
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { AuthApi } from './api'

export const AuthHandlers = HttpApiBuilder.group(AuthApi, 'auth', (handlers) =>
  handlers
    .handle('register', ({ payload }) => register(payload))
    .handle('login', ({ payload }) => login(payload))
    .handle('me', () => me),
)
```

No stubs left. Every endpoint in the group is answered by real code, and the
three `Effect.die` placeholders from
[email and password](/learn/http-auth-api/02-email-and-password) are gone.

The handler returns a whole `User`, hash and all. It never gets encoded as one,
because the endpoint declared `User.json` and the encoding happens on the way
out. Here is the actual response:

```
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"01a09eca-2a66-7601-9127-04bc306423e9","name":"Ada Lovelace",
 "email":"ada@example.com","createdAt":"2026-09-14T07:20:44.392Z"}
```

The value in memory had a `passwordHash`. The bytes on the wire do not, and no
handler did that.

## A token for a user who is gone

`findById` fails when there is no row. That happens with a perfectly valid,
unexpired token: the account was deleted in the last hour, and the token has
not caught up.

That is the branch caught above, and it returns 401 rather than 404. Both look
defensible, and 401 is the right one. A 404 tells whoever holds that token that
their credential is still good and merely pointed at nothing, which is a useful
hint for somebody working through stolen tokens. The credential no longer
identifies anybody, so the honest answer is the same one a forged token gets.

This is also the payoff for `CurrentUser` carrying only an id. A middleware
that trusted the token's claims would have cheerfully returned the name of a
user who no longer exists.

## When the code breaks

Every handler here turns its unexpected failures into defects, and that is the
right call: a `SqlError` is not something a caller can act on. But a defect
ends the request with a 500 and no body whatsoever, so a client cannot tell a
broken database from a broken deploy, and cannot show the person in front of it
anything at all.

One more middleware fixes that, and it is the last one.

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
import { Schema } from 'effect'
import { HttpApiMiddleware } from 'effect/unstable/httpapi'
// ---cut---
// src/errors.ts, the last one
export class InternalError extends Schema.TaggedError<InternalError>()(
  'InternalError',
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}
```

```ts twoslash
// @filename: src/errors.ts
import { Schema } from 'effect'

export class InternalError extends Schema.TaggedError<InternalError>()(
  'InternalError',
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}

// @filename: src/api.ts
// ---cut---
// src/api.ts, one more middleware on the API
import { HttpApiMiddleware } from 'effect/unstable/httpapi'
import { InternalError } from './errors'

export class CrashHandler extends HttpApiMiddleware.Service<CrashHandler>()(
  'CrashHandler',
  { error: InternalError },
) {}
```

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

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  'Unauthorized',
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class InternalError extends Schema.TaggedError<InternalError>()(
  'InternalError',
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}
// @filename: src/api.ts
import { Context } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
} from 'effect/unstable/httpapi'
import {
  LoginPayload,
  LoginResult,
  RegisterPayload,
  User,
  UserId,
} from './domain'
import {
  EmailAlreadyTaken,
  InternalError,
  InvalidCredentials,
  Unauthorized,
  ValidationFailed,
} from './errors'

export class CurrentUser extends Context.Service<
  CurrentUser,
  { readonly userId: typeof UserId.Type }
>()('CurrentUser') {}

export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentUser; requires: never }
>()('Authorization', {
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}

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

export const me = HttpApiEndpoint.get('me', '/me', {
  success: User.json,
}).middleware(Authorization)

export class ErrorHandler extends HttpApiMiddleware.Service<ErrorHandler>()(
  'ErrorHandler',
  { error: ValidationFailed },
) {}

export class CrashHandler extends HttpApiMiddleware.Service<CrashHandler>()(
  'CrashHandler',
  { error: InternalError },
) {}

export const AuthApi = HttpApi.make('AuthApi')
  .add(HttpApiGroup.make('auth').add(register, login, me))
  .middleware(ErrorHandler)
  .middleware(CrashHandler)
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

import { Authorization, CurrentUser } from './api'
import { Unauthorized } from './errors'

export const AuthorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const tokens = yield* Tokens

    const verifyToken = Effect.fn('verifyToken')(
      function* (token: string) {
        const result = yield* tokens.verify(token)
        return yield* Schema.decodeUnknownEffect(UserId)(result.payload.sub)
      },
      Effect.catch(() => new Unauthorized({ message: 'Invalid token' })),
    )

    return Authorization.of({
      bearer: Effect.fn(function* (httpEffect, { credential }) {
        const userId = yield* verifyToken(Redacted.value(credential))

        return yield* Effect.provideService(httpEffect, CurrentUser, { userId })
      }),
    })
  }),
)
// ---cut---
// src/auth.ts, below the other two layers
import { CrashHandler } from './api'
import { InternalError } from './errors'

export const CrashHandlerLayer = Layer.succeed(CrashHandler, (httpEffect) =>
  Effect.catchDefect(httpEffect, (defect) =>
    Effect.logError('Unhandled defect', defect).pipe(
      Effect.andThen(new InternalError({ message: 'Something went wrong' })),
    ),
  ),
)
```

`Effect.catchDefect` sees only defects, so every typed failure the handlers
declare passes through it untouched. What it does catch gets logged in full and
answered with a sentence that gives nothing away:

```
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{"_tag":"InternalError","message":"Something went wrong"}
```

The uselessness of that message is the point. A `SqlError` names tables and
sometimes credentials, and a stack trace names your file layout, so neither
belongs in a response to somebody you have never met. The caller gets a `_tag`
they can branch on and a sentence they can display. You get the rest, in the
log, with the trace it happened on.

## Stacking it up

`main.ts` has grown a line at a time: the repository in
[the user table](/learn/http-auth-api/03-the-user-table), the hasher and the
error handler in
[hashing the password](/learn/http-auth-api/04-hashing-the-password), the
tokens in [signing the token](/learn/http-auth-api/05-signing-the-token). One
piece is left, and it is the one that does not follow the pattern.

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

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  'Unauthorized',
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class InternalError extends Schema.TaggedError<InternalError>()(
  'InternalError',
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}
// @filename: src/api.ts
import { Context } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
} from 'effect/unstable/httpapi'
import {
  LoginPayload,
  LoginResult,
  RegisterPayload,
  User,
  UserId,
} from './domain'
import {
  EmailAlreadyTaken,
  InternalError,
  InvalidCredentials,
  Unauthorized,
  ValidationFailed,
} from './errors'

export class CurrentUser extends Context.Service<
  CurrentUser,
  { readonly userId: typeof UserId.Type }
>()('CurrentUser') {}

export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentUser; requires: never }
>()('Authorization', {
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}

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

export const me = HttpApiEndpoint.get('me', '/me', {
  success: User.json,
}).middleware(Authorization)

export class ErrorHandler extends HttpApiMiddleware.Service<ErrorHandler>()(
  'ErrorHandler',
  { error: ValidationFailed },
) {}

export class CrashHandler extends HttpApiMiddleware.Service<CrashHandler>()(
  'CrashHandler',
  { error: InternalError },
) {}

export const AuthApi = HttpApi.make('AuthApi')
  .add(HttpApiGroup.make('auth').add(register, login, me))
  .middleware(ErrorHandler)
  .middleware(CrashHandler)
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

import { Authorization, CurrentUser } from './api'
import { Unauthorized } from './errors'

export const AuthorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const tokens = yield* Tokens

    const verifyToken = Effect.fn('verifyToken')(
      function* (token: string) {
        const result = yield* tokens.verify(token)
        return yield* Schema.decodeUnknownEffect(UserId)(result.payload.sub)
      },
      Effect.catch(() => new Unauthorized({ message: 'Invalid token' })),
    )

    return Authorization.of({
      bearer: Effect.fn(function* (httpEffect, { credential }) {
        const userId = yield* verifyToken(Redacted.value(credential))

        return yield* Effect.provideService(httpEffect, CurrentUser, { userId })
      }),
    })
  }),
)

import { CrashHandler } from './api'
import { InternalError } from './errors'

export const CrashHandlerLayer = Layer.succeed(CrashHandler, (httpEffect) =>
  Effect.catchDefect(httpEffect, (defect) =>
    Effect.logError('Unhandled defect', defect).pipe(
      Effect.andThen(new InternalError({ message: 'Something went wrong' })),
    ),
  ),
)
// @filename: src/handlers.ts
import { Effect, Option } from 'effect'
import { RegisterPayload, User } from './domain'
import { EmailAlreadyTaken } from './errors'
import { UserRepo } from './repo'
import { PasswordHasher } from './auth'
import { LoginPayload } from './domain'
import { InvalidCredentials, Unauthorized } from './errors'
import { CurrentUser } from './api'
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

export const me = Effect.gen(function* () {
  const { userId } = yield* CurrentUser
  const users = yield* UserRepo

  return yield* users.findById(userId)
}).pipe(
  Effect.catchTag('NoSuchElementError', () =>
    Effect.fail(new Unauthorized({ message: 'Invalid token' })),
  ),
  Effect.catch((error) =>
    error instanceof Unauthorized ? Effect.fail(error) : Effect.die(error),
  ),
)

import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { AuthApi } from './api'

export const AuthHandlers = HttpApiBuilder.group(AuthApi, 'auth', (handlers) =>
  handlers
    .handle('register', ({ payload }) => register(payload))
    .handle('login', ({ payload }) => login(payload))
    .handle('me', () => me),
)
// @filename: src/main.ts
// ---cut---
// src/main.ts
import { Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { BunHttpServer, BunRuntime } from '@effect/platform-bun'
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { AuthApi } from './api'
import {
  AuthorizationLayer,
  CrashHandlerLayer,
  ErrorHandlerLayer,
  PasswordHasher,
  Tokens,
} from './auth'
import { AuthHandlers } from './handlers'
import { UserRepo } from './repo'

const SqlLive = SqliteClient.layer({ filename: 'auth.db' })

const ServicesLive = Layer.mergeAll(
  UserRepo.layer,
  PasswordHasher.layer,
  Tokens.layer,
).pipe(Layer.provide(SqlLive))

const ApiLive = HttpApiBuilder.layer(AuthApi).pipe(
  Layer.provide(AuthHandlers),
  Layer.provide(AuthorizationLayer),
  Layer.provide(ErrorHandlerLayer),
  Layer.provide(CrashHandlerLayer),
  HttpRouter.provideRequest(ServicesLive),
  Layer.provide(Tokens.layer),
)

const ServerLive = HttpRouter.serve(ApiLive).pipe(
  Layer.provide(BunHttpServer.layer({ port: 3000, hostname: '127.0.0.1' })),
)

BunRuntime.runMain(Layer.launch(ServerLive))
```

The three services behind `provideRequest` got a name, `ServicesLive`, and the
two remaining middlewares went on with `Layer.provide`, because middleware
belongs to the API rather than to a request.

Then `Tokens.layer` appears a second time on its own line, which looks like a
mistake and is not. `AuthorizationLayer` reads the signing secret when the
application starts, not when a request arrives, so it is not a per-request
dependency and `provideRequest` never reaches it. Naming a layer twice in one
graph still builds it once, so there is one `Tokens` and one secret.

`HttpRouter.serve` turns the routes into something that wants a server.
`BunHttpServer.layer` is that server. `Layer.launch` starts it and holds it
open, and `runMain` handles the interrupt when you press control C.

That `hostname` is not decoration. Leave it out and the code still compiles,
then dies on startup:

```
ERROR (#2): ServeError:
  [cause]: NetAddressError: expected exactly four decimal octets
```

Bun binds an IPv6 address when you do not name one, and the address parser in
this release candidate reads IPv4 only. It is a bug rather than a design, and
naming the host avoids it. Keep it in every serve snippet until it is fixed.

## The whole thing, end to end

```sh
curl -s -X POST 127.0.0.1:3000/register -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com","password":"Secret1"}'

TOKEN=$(curl -s -X POST 127.0.0.1:3000/login -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"Secret1"}' | jq -r .token)

curl -s 127.0.0.1:3000/me -H "authorization: Bearer $TOKEN"
curl -i -s 127.0.0.1:3000/me
```

Register returns a user with no hash. Login returns a token. `/me` with the
token returns the same user.

Every other answer the service can give now carries a `_tag` and a body, which
is worth seeing in one place:

```
400  {"_tag":"ValidationFailed","issues":[{"path":"email","message":"Not a valid email"}]}
401  {"_tag":"Unauthorized","message":"Invalid token"}
401  {"_tag":"InvalidCredentials"}
409  {"_tag":"EmailAlreadyTaken","email":"ada@example.com"}
500  {"_tag":"InternalError","message":"Something went wrong"}
```

A client can branch on the tag without parsing prose, and nothing in that list
tells an attacker anything they did not already send.

## What people get wrong

Writing a second type for the response after all, because `User.json` is
unfamiliar and a hand written struct is not. It works on the day it is written.
The failure arrives months later, in a commit that adds a column and touches
one of the two places.

The other is putting `Effect.catchTag('NoSuchElementError', ...)` inside the
repository so `findById` returns something friendlier. Then every caller gets
the repository's opinion about what a missing row means. Here it means 401.
Somewhere else it will mean an empty list or a retry, and the repository cannot
know which.

## Next

The service is finished and the only way to use it is `curl`.
[Bonus: API docs with Scalar](/learn/http-auth-api/08-bonus-scalar) turns the
API value you declared at the start into a page you can register, log in and
call `/me` from, without leaving the browser.
