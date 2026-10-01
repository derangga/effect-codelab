---
title: Exporting
order: 4
slug: 04-exporting
summary: One layer in main.ts sends every span and log record to the collector, and the first trace shows which spans the API is still missing.
---

The stack is running and the API does not know it exists. Spans are being built
and thrown away, and logs are going to the console and nowhere else. Sending
them out takes one layer, and the interesting part is how little else changes.

The layer is `Otlp.layerFromConfig`. It builds the three exporters from chapter
one, the one for traces, the one for logs and the one for metrics, and reads
where to send them from environment variables. You already wrote those, in
[running the stack](/learn/observability/03-running-the-stack).

## The layer

`Otlp.layerFromConfig` cannot work alone, and it asks for two things.

It needs an **HTTP client**, because OTLP is plain HTTP and something has to make
the requests. `FetchHttpClient.layer` is one built on the `fetch` that Bun
already has. And it needs a **serialization**, which decides how a batch of
spans becomes bytes in the request body. `OtlpSerialization.layerJson` writes
JSON, which the collector's HTTP port accepts and which you can read in a
network trace if you ever need to. A protobuf version, `layerProtobuf`, is there
too, and is smaller on the wire.

Put the three together as `TelemetryLive`, then give it to the server. The
highlighted lines are the whole change to `src/main.ts`:

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

// A real argon2id hash of a password nobody has. Verifying against it costs the
// same as verifying a real account, so an unknown email takes as long to reject.
const NO_ACCOUNT_HASH =
  '$argon2id$v=19$m=65536,t=2,p=1$d9Ej3Ion8+LjpdeI7HcyisadM562uhpJSJ22JxZphhI$cSAOiN2Jmo7MHgrdmr7/4YK4UcnwvtFgSobWLeqIWc8'

export const login = Effect.fn('login')(
  function* (payload: LoginPayload) {
    const users = yield* UserRepo
    const hasher = yield* PasswordHasher
    const tokens = yield* Tokens

    const found = yield* users.findByEmail(payload.email)
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

import { HttpApiBuilder } from 'effect/http-api'
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
import { FetchHttpClient, HttpRouter } from 'effect/http' // [!code highlight]
import { HttpApiBuilder } from 'effect/http-api'
import { Otlp, OtlpSerialization } from 'effect/observability' // [!code highlight]
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

const TelemetryLive = Otlp.layerFromConfig().pipe( // [!code highlight:4]
  Layer.provide(OtlpSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer),
)

const ServerLive = HttpRouter.serve(ApiLive).pipe(
  Layer.provide(BunHttpServer.layer({ port: 3000, hostname: '127.0.0.1' })),
  Layer.provide(TelemetryLive), // [!code highlight]
)

BunRuntime.runMain(Layer.launch(ServerLive))
```

`TelemetryLive` is provided to `ServerLive`, the outermost layer, so that the
tracer and the logger are in place for everything the server runs. Placement
matters here. Provide it only to `ApiLive` and your handlers' spans are still
exported, but the span the server opens around each request is not, and neither
is the `Sent HTTP response` log line. Both are created outside `ApiLive`.

If you added the Scalar docs in the bonus chapter, your `main.ts` has a few more
lines than this one. Keep them. The change is the same two imports and the same
two `Layer.provide` additions.

## What the environment lines do

`layerFromConfig` reads standard OpenTelemetry variables once, when the layer is
built. The four from the last chapter are enough:

| Variable | What it does |
| --- | --- |
| `OTEL_SERVICE_NAME` | The name every span and log carries. It is the `service_name` you will filter on in Loki. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | The collector's address. The exporter adds `/v1/traces` and `/v1/logs` itself. |
| `OTEL_TRACES_EXPORTER` | Set to `otlp` to turn trace export on. |
| `OTEL_LOGS_EXPORTER` | Set to `otlp` to turn log export on. |

There is no `OTEL_METRICS_EXPORTER`, on purpose. That one would export metrics the
app defines with Effect's `Metric` module, and this app defines none. Its metrics
come from the collector, which derives them from the spans.

Two failure behaviours are worth knowing before you rely on this.

With nothing set, `layerFromConfig` installs nothing. Comment out the four lines
in `.env` and the API behaves exactly as it did before this chapter, with no
errors and no network calls. That is why a test run needs no special setup: the
telemetry layer is always present, and it only does anything when the variables
say so.

With a bad value, it fails when the process starts. Set
`OTEL_EXPORTER_OTLP_ENDPOINT=not-a-url` and the API exits at once:

```
ERROR (#2): ConfigError: SchemaError(Expected a valid URL string
  at ["OTEL_EXPORTER_OTLP_ENDPOINT"])
```

A typo should be loud when you deploy it. What should not be loud is the stack
being down. If the collector is unreachable, the exporter retries a few times
and then drops the batch, and the API keeps answering. Telemetry is never
allowed to take the service with it.

## Send some requests

Restart the API so it picks up the layer, and leave it running. `--watch`
restarts it on every file change, which the next chapters use.

```sh
bun --watch src/main.ts
```

In another terminal, make the four requests from the end of the last track, with
one wrong password at the end so there is a failure to look at:

```sh
curl -s -X POST 127.0.0.1:3000/register -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com","password":"Secret1"}'

TOKEN=$(curl -s -X POST 127.0.0.1:3000/login -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"Secret1"}' | jq -r .token)

curl -s 127.0.0.1:3000/me -H "authorization: Bearer $TOKEN"

curl -s -X POST 127.0.0.1:3000/login -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"wrong"}'
```

If you ran the track's own examples already, `register` answers
`EmailAlreadyTaken`. That is fine, the user exists and the rest still works.

## Find the trace

Open Grafana at [http://127.0.0.1:3001](http://127.0.0.1:3001), choose
**Explore** in the left menu, and pick **Tempo** as the data source. Make sure
the query type says **TraceQL**, TraceQL being Tempo's query language for traces.
Paste this and press Shift and Enter:

```
{ resource.service.name = "effect-auth-api" }
```

It selects every trace that has a span from your service. A table lists them,
newest first.

![Grafana Explore showing five traces from effect-auth-api: a failed login, a GET, a login, a register, and a sql.execute from startup](/images/observability-trace-list.webp)

Reading from the top: the wrong-password login, `/me`, the good login, and
`/register`. The last row is `sql.execute` on its own. That is the
`CREATE TABLE IF NOT EXISTS` the repository runs when the API starts, and since
no request was running, it is a trace of one span.

All three `POST` rows are called `http.server POST`. That is the span the
server opens for every request, and its name carries only the method. The path is
stored on it as an attribute, and the header of the trace view shows it. Click
the trace ID of a login, the one whose header ends in `/login` with a 200.

![Grafana trace view of POST /login: three spans, http.server POST of 61ms, a login span of 60ms, and a sql.execute of 70 microseconds](/images/observability-first-trace.webp)

This is a waterfall, and the interesting part is what it leaves out. The
request took 61 milliseconds. The `login` span covers 60 of them. Its only
child is `sql.execute`, which took 70 microseconds. About 60 milliseconds sit
inside `login` with nothing under them.

That time is the password check and the token signing, and neither has a span.
The tracer cannot show work nobody named. `Effect.fn` with a name makes a span,
and the hasher and the token service use plain functions, so they never appear.
The repository's `findByEmail` is missing too, and so is a way to tell which
user this was.

## What people get wrong

Setting the endpoint and stopping there. Without `OTEL_TRACES_EXPORTER=otlp` the
exporter stays off, the API starts normally, and Tempo stays empty. Nothing
errors, because "no exporter" is a valid configuration. When no traces turn up,
check the two `*_EXPORTER` lines before the collector.

## Next

The trace is real and half empty. [Filling the trace](/learn/observability/05-filling-the-trace)
names the steps that are missing, renames the ones that are inconsistent, and
puts the user id on the span, without writing down the email.
