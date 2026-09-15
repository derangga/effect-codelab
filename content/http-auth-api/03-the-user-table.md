---
title: The user table
order: 3
slug: 03-the-user-table
summary: One declaration that is the table, the insert and the response at once, and a repository over sqlite that cannot hand a password hash to a caller.
---

A user has to be stored somewhere, and the obvious place to put the SQL is the
handler that needs it. That works until the second handler needs the same
query, and it never survives changing the database.

So the SQL goes behind a **repository**: an object with a few named methods
like `insert` and `findById`, which the rest of the code calls without knowing
there is a database at all. That is the
[services](/learn/basic-effect/06-services) argument applied to storage.

## Talking to sqlite

Sqlite is a single file, so connecting is naming it.

```ts twoslash
// src/main.ts
import { SqliteClient } from '@effect/sql-sqlite-bun'

const SqlLive = SqliteClient.layer({ filename: 'auth.db' })
//    ^?
```

That is a **layer**, which is Effect's word for a recipe that builds something
the rest of the program can ask for. Look at the two `never`s in the type: this
one cannot fail and needs nothing else to build. Sqlite really is that simple
to start.

It goes in `main.ts` rather than `repo.ts` because it is a choice about this
deployment, not about users. The repository asks for a database and does not
care which file it is, which is what lets a test hand it a different one.
Nothing holds it yet. The last section of this chapter hands it over.

## One row, three shapes

A user row has five columns, and three different shapes of it exist.

What the table holds, including the password hash. What you supply when
inserting, which is the same thing minus the id and the timestamp, because
those get generated. And what a response is allowed to contain, which is the
row with the password hash removed.

Writing each one out is no hardship, and stating a shape explicitly instead of
inferring it is a good habit. Here are two of the three:

```ts twoslash
import { Schema } from 'effect'
// ---cut---
const UserRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  passwordHash: Schema.String,
  createdAt: Schema.String,
})

const PublicUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  createdAt: Schema.String,
})
```

The cost is not writing them. It is that nothing connects them. Adding a
`phone` column is one decision that has to be made twice, in two files, and
both ways of getting the second one wrong are quiet. Leave it out of the
response and the field simply never appears. Copy the row a little too
faithfully and a password hash does. No test fails, and neither does the
build.

## One declaration, every shape

`Model.Class` declares the fields once and derives the rest. The id gets a
brand of its own first, in the same shape as the `Email` from
[email and password](/learn/http-auth-api/02-email-and-password), so that a
user id and any other string stop being interchangeable.

```ts twoslash
import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

const Email = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'Not a valid email' }),
  ),
  Schema.brand('Email'),
)
// ---cut---
// src/domain.ts
export const UserId = Schema.String.pipe(Schema.brand('UserId'))

export class User extends Model.Class<User>('User')({
  id: Model.UuidV7Insert(UserId),
  name: Schema.String,
  email: Email,
  passwordHash: Model.Sensitive(Schema.String),
  createdAt: Model.DateTimeInsert,
}) {}
```

`UserId` has no check on it, unlike `Email`. There is no shape to test for,
because nothing hand writes one: the next section generates every id there will
ever be.

Three of those field wrappers are doing the work.

`Model.Sensitive` means the field belongs to the database and never to JSON.
`Model.UuidV7Insert` generates an id when you insert, and version 7 uuids sort
by the time they were made, so rows come back in creation order for free.
`Model.DateTimeInsert` stamps the row when it is written.

This is where the brand from the last chapter earns itself. `Model.UuidV7Insert`
does not merely prefer a branded schema, it requires one. Hand it a plain
`Schema.String` and it will not compile.

## The shapes it derived

`User` is now four schemas wearing one name.

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

There is no `passwordHash` in it. Not because a handler leaves it out, but
because the type does not have one.
[Me and the public user](/learn/http-auth-api/07-me-and-the-public-user) wires
exactly this as the response for `/me`, and the compiler enforces the thing you
would otherwise be trusting yourself to remember.

That retires something. The `PublicUser` you wrote in `domain.ts` in
[the API as a value](/learn/http-auth-api/01-the-api-as-a-value) was the first
sketch of this shape, and `User.json` is the same idea derived rather than
typed. Delete `PublicUser`, and change the two endpoints that name it to use
`User.json` instead. That is the last hand written copy of a user gone.

## The table that matches

Both generated fields encode to text, so both columns are text. A uuid is a
string like `01a09ec8-ebe4-778e-916a-e09205d04a03`, and a timestamp is a string
like `2026-09-14T07:19:22.855Z`.

```sql
-- run from src/repo.ts when the layer starts
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  createdAt    TEXT NOT NULL
)
```

Column names are the field names exactly, so they are camel case here. That
`UNIQUE` on email is what makes a duplicate signup fail in the database rather
than in a check that two simultaneous requests can both pass.

Running that statement when the layer starts is the whole migration story for
this track, and it has a ceiling worth naming out loud: it can create a table,
never change one. The first time a column has to move, you want
`SqliteMigrator` and a folder of numbered files instead.

## The repository

Most of the methods are the same four every table needs, so they are generated
from the model.

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
// @filename: src/repo.ts
// ---cut---
// src/repo.ts
import { Effect } from 'effect'
import { SqlModel } from 'effect/unstable/sql'
import { User } from './domain'

const repository = Effect.gen(function* () {
  return yield* SqlModel.makeRepository(User, {
    tableName: 'users',
    spanPrefix: 'UserRepo',
    idColumn: 'id',
  })
})
```

That gives `insert`, `update`, `findById` and `delete`.

What it cannot give is the query this service actually needs. Logging in means
finding somebody by email, and no generator can guess that, so it gets written.

The finished file puts all three things together: the table, the generated
methods, and the one query written by hand.

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
// @filename: src/repo.ts
// ---cut---
// src/repo.ts
import { Context, Effect, Layer } from 'effect'
import { SqlClient, SqlModel, SqlSchema } from 'effect/unstable/sql'
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
```

`UserRepo.layer` is what the rest of the application asks for, and it is the
only thing this file exports. Nothing outside it knows there is SQL in here.

`findOneOption` returns an `Option`, which is either `Some` with a user or
`None` with nothing. That matters when
[signing the token](/learn/http-auth-api/05-signing-the-token): an unknown
email is a normal outcome of logging in, not an error. Its sibling `findOne`
treats a missing row as a failure instead, and so does the generated
`findById`.

## Wiring it up

`SqlLive` and `UserRepo.layer` are both recipes, and so far nothing has asked
for either. `main.ts` is where that happens.

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
import { Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { BunHttpServer, BunRuntime } from '@effect/platform-bun'
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { AuthApi } from './api'
import { AuthHandlers } from './handlers'
import { UserRepo } from './repo'
// ---cut---
// src/main.ts, the ApiLive from the last chapter with the repository added
const SqlLive = SqliteClient.layer({ filename: 'auth.db' })

const ApiLive = HttpApiBuilder.layer(AuthApi).pipe(
  Layer.provide(AuthHandlers),
  HttpRouter.provideRequest(UserRepo.layer.pipe(Layer.provide(SqlLive))),
)
```

`SqlLive` goes to `UserRepo.layer` rather than to the application, because the
repository is the only thing that wants a database. `provideRequest` is the
version of `Layer.provide` that reaches a handler, and
[me and the public user](/learn/http-auth-api/07-me-and-the-public-user) says
why handlers need their own. No handler asks for `UserRepo` yet, so no response
changes.

Something on disk does:

```sh
bun run src/main.ts
sqlite3 auth.db '.schema users'
```

```
CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  ...
);
```

The file and the table both appeared at startup, because building `UserRepo`
is what runs that `CREATE TABLE`.

## What people get wrong

Calling `insert` with the fields you have.

```ts
yield* repo.insert({ name, email, passwordHash })
```

That does not compile, and the error is confusing because it asks for `id` and
`createdAt`, the two things the model was supposed to generate. It generates
them in a constructor, not in the insert.

```ts
const row = yield* User.insert.makeEffect({ name, email, passwordHash })
yield* repo.insert(row)
```

Two steps, always. `makeEffect` is an Effect rather than a plain function
because generating that id and reading that clock are things a test may want to
control, and this is what makes a repository test able to produce the same row
twice.

## Next

There is a table, and a way in and out of it. What goes in the `passwordHash`
column is still an open question, and the answer is emphatically not the
password. [Hashing the password](/learn/http-auth-api/04-hashing-the-password)
settles it, writes the register handler, and gives the empty 400 from chapter
two its body back.
