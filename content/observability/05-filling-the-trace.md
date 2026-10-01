---
title: Filling the trace
order: 5
slug: 05-filling-the-trace
summary: Name the steps the first trace was missing, give every span a Service.method name, and put the user id on the span without writing down the email.
---

The first trace answered nothing. The request took 61 milliseconds, the `login`
span took 60 of them, and its only child accounted for 70 microseconds. Three
things were wrong, and each has a small fix.

Some steps have no span at all: hashing, signing, and the lookup by email. Some
spans have names that will not survive growing: `login` and `register` say what
a function does but not where it lives, while the repository's own spans are
called `UserRepo.insert`. And a trace of a failing login cannot say whose account
it was.

## One naming rule

Every span gets a name of the form `Service.method`. The name is the first thing
you read in a waterfall, and later it becomes a label on every metric, so it has
to say where to look. `findById` could be the repository's or a handler's.
`UserRepo.findById` can only be one thing.

The repository already follows the rule without help. `SqlModel.makeRepository`
was given `spanPrefix: 'UserRepo'` in the track before, and that is why
`UserRepo.insert` and `UserRepo.findById` showed up in the first place. The rest
of the code gets brought in line with it.

## Naming a function

`Effect.fn` with a string first makes a span every time the function runs. You
have used the generator form already. The same call also wraps a plain function
that returns an effect, so the hasher and the token service change very little:

```ts twoslash
// @filename: src/domain.ts
import { Schema } from 'effect'
import { Model } from 'effect/schema'

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
} from 'effect/http-api'
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
// ---cut---
// src/auth.ts
import {
  Config,
  Context,
  Effect,
  Layer,
  Redacted,
  Schema,
  SchemaIssue,
} from 'effect'
import { password } from 'bun'
import { HttpApiMiddleware } from 'effect/http-api'
import { Authorization, CrashHandler, CurrentUser, ErrorHandler } from './api'
import { jwtVerify, SignJWT } from 'jose'
import { InternalError, Unauthorized, ValidationFailed } from './errors'
import { UserId } from './domain'

export class PasswordHasher extends Context.Service<PasswordHasher>()(
  'PasswordHasher',
  {
    make: Effect.gen(function* () {
      const hash = Effect.fn('PasswordHasher.hash')((plain: string) => // [!code highlight:3]
        Effect.promise(() => password.hash(plain)),
      )

      const verify = Effect.fn('PasswordHasher.verify')( // [!code highlight:4]
        (plain: string, hashed: string) =>
          Effect.promise(() => password.verify(plain, hashed)),
      )

      return { hash, verify } as const
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}

export class Tokens extends Context.Service<Tokens>()('Tokens', {
  make: Effect.gen(function* () {
    const secret = yield* Config.Redacted('JWT_SECRET')
    const key = new TextEncoder().encode(Redacted.value(secret))

    const issue = Effect.fn('Tokens.issue')((userId: string) => // [!code highlight:10]
      Effect.promise(() =>
        new SignJWT({})
          .setProtectedHeader({ alg: 'HS256' })
          .setSubject(userId)
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(key),
      ),
    )

    const verify = Effect.fn('Tokens.verify')((token: string) => // [!code highlight:5]
      Effect.tryPromise(() =>
        jwtVerify(token, key, { requiredClaims: ['exp'] }),
      ),
    )

    return { issue, verify } as const
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

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

export const AuthorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const tokens = yield* Tokens

    const verifyToken = Effect.fn('Authorization.verifyToken')( // [!code highlight]
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

export const CrashHandlerLayer = Layer.succeed(CrashHandler, (httpEffect) =>
  Effect.catchDefect(httpEffect, (defect) =>
    Effect.logError('Unhandled defect', defect).pipe(
      Effect.andThen(new InternalError({ message: 'Something went wrong' })),
    ),
  ),
)
```

Read the highlighted lines. In each, the function that was there before is the
same, and it now sits inside `Effect.fn('...')(` and a closing parenthesis. The
body did not change, so the errors did not change either. The three
`Effect.promise` calls still turn a rejection into a defect, and `Tokens.verify`
still fails with a typed error through `Effect.tryPromise`. A span records what
happened. It does not catch anything.

`verifyToken` was already traced, as `verifyToken`. It becomes
`Authorization.verifyToken`, after the middleware it belongs to.

The `bearer` function a few lines below has no span and should not get one. It
is `Effect.fn` with only a body, and as the first chapter said, a function with
no name is invisible to the tracer. `verifyToken` and the `Tokens` call inside
it already show everything that function does.

`findByEmail` is the odd one, because it is not a function you wrote. It is what
`SqlSchema.findOneOption` returns, which is itself a function from a request to
an effect. `Effect.fn` takes it as it is:

```ts twoslash
// @filename: src/domain.ts
import { Schema } from 'effect'
import { Model } from 'effect/schema'

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
} from 'effect/http-api'
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
// ---cut---
// src/repo.ts
import { Context, Effect, Layer } from 'effect'
import { SqlClient, SqlModel, SqlSchema } from 'effect/sql'
import { Email, User } from './domain'

export class UserRepo extends Context.Service<UserRepo>()('UserRepo', {
  make: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      email        TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      createdAt    TEXT NOT NULL
    )`

    const repository = yield* SqlModel.makeRepository(User, {
      tableName: 'users',
      spanPrefix: 'UserRepo',
      idColumn: 'id',
    })

    const findByEmail = Effect.fn('UserRepo.findByEmail')( // [!code highlight:7]
      SqlSchema.findOneOption({
        Request: Email,
        Result: User,
        execute: (email) => sql`SELECT * FROM users WHERE email = ${email}`,
      }),
    )

    return { ...repository, findByEmail } as const
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
```

## Naming a value, and a name for the handlers

The handlers get the same treatment, with one difference. `register` and `login`
are functions, so their `Effect.fn('register')` just becomes
`Effect.fn('AuthHandlers.register')`, and `login` likewise.

`me` is not a function. It is an effect you hand over as it is, with no
arguments. `Effect.fn` has nothing to wrap, so the span comes from
`Effect.withSpan`, which names any effect value and goes at the end of its pipe.
Use `Effect.fn` for functions and `Effect.withSpan` for values, and the tracer
sees no difference.

```ts twoslash
// @filename: src/domain.ts
import { Schema } from 'effect'
import { Model } from 'effect/schema'

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
} from 'effect/http-api'
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
import { SqlClient, SqlModel, SqlSchema } from 'effect/sql'
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

    const verify = (token: string) =>
      Effect.tryPromise(() => jwtVerify(token, key, { requiredClaims: ['exp'] }))

    return { issue, verify } as const
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

import { SchemaIssue } from 'effect'
import { HttpApiMiddleware } from 'effect/http-api'
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
// ---cut---
// src/handlers.ts
import { Effect, Option } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { AuthApi, CurrentUser } from './api'
import { PasswordHasher, Tokens } from './auth'
import { LoginPayload, RegisterPayload, User } from './domain'
import { EmailAlreadyTaken, InvalidCredentials, Unauthorized } from './errors'
import { UserRepo } from './repo'

export const register = Effect.fn('AuthHandlers.register')( // [!code highlight]
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

// A real argon2id hash of a password nobody has. Verifying against it costs the
// same as verifying a real account, so an unknown email takes as long to reject.
const NO_ACCOUNT_HASH =
  '$argon2id$v=19$m=65536,t=2,p=1$d9Ej3Ion8+LjpdeI7HcyisadM562uhpJSJ22JxZphhI$cSAOiN2Jmo7MHgrdmr7/4YK4UcnwvtFgSobWLeqIWc8'

export const login = Effect.fn('AuthHandlers.login')( // [!code highlight]
  function* (payload: LoginPayload) {
    const users = yield* UserRepo
    const hasher = yield* PasswordHasher
    const tokens = yield* Tokens

    const found = yield* users.findByEmail(payload.email)
    if (Option.isSome(found)) { // [!code highlight:3]
      yield* Effect.annotateCurrentSpan('userId', found.value.id)
    }
    const hash = Option.isSome(found) ? found.value.passwordHash : NO_ACCOUNT_HASH

    const matches = yield* hasher.verify(payload.password, hash)
    if (Option.isNone(found) || !matches) {
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
  yield* Effect.annotateCurrentSpan('userId', userId) // [!code highlight]
  const users = yield* UserRepo

  return yield* users.findById(userId)
}).pipe(
  Effect.catchTag('NoSuchElementError', () =>
    Effect.fail(new Unauthorized({ message: 'Invalid token' })),
  ),
  Effect.catch((error) =>
    error instanceof Unauthorized ? Effect.fail(error) : Effect.die(error),
  ),
  Effect.withSpan('AuthHandlers.me'), // [!code highlight]
)

export const AuthHandlers = HttpApiBuilder.group(AuthApi, 'auth', (handlers) =>
  handlers
    .handle('register', ({ payload }) => register(payload))
    .handle('login', ({ payload }) => login(payload))
    .handle('me', () => me),
)
```

## Putting the user on the span

`Effect.annotateCurrentSpan('userId', ...)` adds an attribute to whichever span
is running. In `login` that is `AuthHandlers.login`, and in `me` it is
`AuthHandlers.me`. Once a request has failed, the trace is what you have, and
a user id on it turns "somebody failed to log in" into "this account did".

The id goes on and the email does not, and that is deliberate. An attribute is
stored with the trace, searchable by anyone with access to Grafana, copied into
every export, and kept as long as the trace is. A user id is a key that means
nothing without your database. An email address is personal data, and for a
failed login it is whatever the caller typed. People do paste passwords into the
wrong field, and a trace that keeps the field keeps the password.

That is also why the annotation sits inside `if (Option.isSome(found))`. An
unknown email has no user, so the span has no `userId`, and nothing is recorded
about the request's input at all.

Effect's other defaults agree. The statement on a `sql.execute` span is stored
with `?` where the values go, so the email in `findByEmail`'s query is never in
the trace. And the server span records request headers but replaces
`Authorization` with `<redacted>`, so a bearer token does not leak either.

## Look again

`bun --watch` restarted the API when you saved the files. Run the four requests
from the last chapter again, find the trace of the good login, and open it:

![Grafana trace view of POST /login with six spans: http.server POST of 57ms, AuthHandlers.login, UserRepo.findByEmail with a sql.execute under it, PasswordHasher.verify of 55ms, and Tokens.issue of 954 microseconds](/images/observability-filled-trace.webp)

Six spans now, and the 60 missing milliseconds have a name.
`PasswordHasher.verify` takes 55 of the 57. Looking up the user took 143
microseconds, and signing the token took 954. The password hash is slow on
purpose, as the hashing chapter said, and now you can see how much of every
login it is.

The other endpoints fill in the same way. A `/register` trace shows
`AuthHandlers.register` over `UserRepo.findByEmail`, `PasswordHasher.hash` and
`UserRepo.insert`. A `/me` trace shows `Authorization.verifyToken` over
`Tokens.verify`, then `AuthHandlers.me` over `UserRepo.findById`. The two are
siblings, because the middleware finishes before the handler starts.

## What people get wrong

Annotating what is easy to reach instead of what is safe. The payload is right
there in `login`, and `Effect.annotateCurrentSpan('email', payload.email)` is
one line. It works, and it puts every typed email address, and every password
pasted in the wrong box, into a store you do not control the retention of. If
you want to know who, annotate the id. If you do not have an id, you do not know
who, and that is the correct thing for the trace to say.

## Next

The trace is complete for a login that works. A login that fails is the one you
will actually go looking for,
and [when login fails](/learn/observability/06-when-login-fails) follows one
from the 401 to its span, its log line, and back.
