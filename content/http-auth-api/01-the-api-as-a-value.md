---
title: The API as a value
order: 1
slug: 01-the-api-as-a-value
summary: Describe register, login and user profile as one value the compiler can read, before writing a single handler.
---

Here is how most backends describe an endpoint.

```js
app.post('/register', async (req, res) => {
  const { email, password, name } = req.body
  // ...
  res.status(201).json(user)
})
```

Ask that code a question and it cannot answer. What does `/register` accept?
Read the body. What does it return? Read further. What can go wrong, and with
which status? Nobody knows without running it. The description of the endpoint
exists only as the behaviour of a function.

This chapter writes the description down instead, as an ordinary value, before
any handler exists.

## An endpoint is five facts

Strip away the framework and every HTTP endpoint is the same five facts:

1. A method, like `POST`.
2. A path, like `/register`.
3. What comes in.
4. What goes out when it works.
5. How it can fail, and with what status.

In the code above, fact one and two are arguments to `app.post`. Facts three
and four are implied by how the function happens to behave. Fact five is
usually a comment, or nothing. We are going to write all five in one place,
where the compiler can see them.

## Shapes first

Facts three and four are shapes of data, and in Effect a shape is a **schema**:
a value that is both a TypeScript type and a runtime validator. One definition,
two jobs. The Basic Effect track built these; here we only use them.

```ts twoslash
// src/domain.ts
import { Schema } from 'effect'

export const RegisterPayload = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  password: Schema.String,
})

export type RegisterPayload = typeof RegisterPayload.Type
//          ^?

export const PublicUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
})
```

Everything in `domain.ts` is exported, because `api.ts` is about to import it.
The same goes for every file in this project: nothing is private to a module
here, because every one of them exists to be assembled in `main.ts`.

`RegisterPayload` is what a caller sends. `PublicUser` is what comes back, and
it holds no password of any kind. It is a first sketch:
[the user table](/learn/http-auth-api/03-the-user-table) replaces it with a
shape derived from the database row, and says so when it does.

Those fields are plain strings for now. The next chapter turns them into an
email that has to look like an email and a password that has to earn its place,
and nothing else in this chapter has to change when it does. That is the point
of putting the shape in one named value.

## Failure is a shape too

Fact five gets the same treatment. A failure is a value with a tag, some
fields, and the HTTP status it should produce.

Failures get a file of their own, `errors.ts`. Every one this service can
return ends up in it, so when a handler fails with something and you want to
know what a caller sees, there is one place to look rather than five.

```ts twoslash
import { Schema } from 'effect'
// ---cut---
// src/errors.ts
export class EmailAlreadyTaken extends Schema.TaggedError<EmailAlreadyTaken>()(
  'EmailAlreadyTaken',
  { email: Schema.String },
  { httpApiStatus: 409 },
) {}
```

The third argument is where the status lives. Declaring it here means no
handler ever writes `res.status(409)`, and every place this error can surface
agrees on what it means.

## One endpoint, all five facts

Now the five facts fit in one expression.

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
// ---cut---
// src/api.ts
import { HttpApiEndpoint, HttpApiSchema } from 'effect/unstable/httpapi'
import { PublicUser, RegisterPayload } from './domain'
import { EmailAlreadyTaken } from './errors'

export const register = HttpApiEndpoint.post('register', '/register', {
  payload: RegisterPayload,
  success: PublicUser.pipe(HttpApiSchema.status(201)),
  error: EmailAlreadyTaken,
})
```

`'register'` is the name this endpoint answers to in code, separate from the
path it answers to over HTTP. `HttpApiSchema.status(201)` says a successful
register is a 201 rather than the default 200.

Nothing has been served. `register` is a value sitting in a variable, and you
could log it, or pass it to a function.

## Grouping them

Login needs two more shapes and one more failure, and each goes in the file its
kind lives in.

```ts twoslash
import { Schema } from 'effect'
// ---cut---
// src/domain.ts
export const LoginPayload = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
})

export type LoginPayload = typeof LoginPayload.Type

export const LoginResult = Schema.Struct({ token: Schema.String })
```

The failure goes in the other file:

```ts twoslash
import { Schema } from 'effect'
// ---cut---
// src/errors.ts
export class InvalidCredentials extends Schema.TaggedError<InvalidCredentials>()(
  'InvalidCredentials',
  {},
  { httpApiStatus: 401 },
) {}
```

Then two more endpoints in `api.ts`, a group to hold all three, and the API
itself.

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
import { HttpApiEndpoint, HttpApiSchema } from 'effect/unstable/httpapi'
import { PublicUser, RegisterPayload } from './domain'
import { EmailAlreadyTaken } from './errors'

export const register = HttpApiEndpoint.post('register', '/register', {
  payload: RegisterPayload,
  success: PublicUser.pipe(HttpApiSchema.status(201)),
  error: EmailAlreadyTaken,
})
// ---cut---
// src/api.ts, below the register endpoint
import { HttpApi, HttpApiGroup } from 'effect/unstable/httpapi'
import { LoginPayload, LoginResult } from './domain'
import { InvalidCredentials } from './errors'

export const login = HttpApiEndpoint.post('login', '/login', {
  payload: LoginPayload,
  success: LoginResult,
  error: InvalidCredentials,
})

export const me = HttpApiEndpoint.get('me', '/me', { success: PublicUser })

export const authGroup = HttpApiGroup.make('auth').add(register, login, me)

export const AuthApi = HttpApi.make('AuthApi').add(authGroup)
```

`/me` has no declared error yet. It needs a caller to prove who they are, and
proving that is a job for middleware, which arrives later. Its failure will be
declared then, in one place, rather than repeated on every endpoint that needs
a login.

## What this bought

The whole surface of the service is now a value. Three things follow from that,
and the rest of the track spends them.

The compiler can check handlers against it. It will refuse to build a server
that forgets an endpoint, or answers one with the wrong shape.

A documentation page can be generated from it, which is the bonus chapter.

And a client can be derived from it, so a frontend calls `login` without anyone
writing a URL. This track does not build that client, but the
[Fullstack Monorepo](/learn/fullstack-monorepo) track is about exactly that.

## What people get wrong

Reaching for a handler first, and treating the declaration as paperwork to be
filled in afterwards. The declaration is the contract. When it comes first, the
handler has nothing left to decide, which is why the handlers in this track are
three or four lines each.

The other one is a compile error worth meeting now. `HttpApiSchema.status`
works by piping onto a schema value, so it cannot be piped onto a class you are
in the middle of declaring.

```ts twoslash
// @errors: 2310 2506
import { Schema } from 'effect'
import { HttpApiSchema } from 'effect/unstable/httpapi'

class TooManyRequests extends Schema.TaggedError<TooManyRequests>()(
  'TooManyRequests',
  {},
).pipe(HttpApiSchema.status(429)) {}
```

The class ends up referencing itself in its own base expression. On an error
class, pass the status as the third argument instead, the way
`EmailAlreadyTaken` does above.

## Next

Three fields on `RegisterPayload` are still plain strings, which means the
service currently accepts `""` as an email and `"a"` as a password.
[Email and password](/learn/http-auth-api/02-email-and-password) makes them
earn their types, and ends by discovering something surprising about what a
caller actually sees when they fail.
