---
title: 'Bonus: API docs with Scalar'
order: 8
slug: 08-bonus-scalar
summary: Turn the API value you declared at the start into a page you can register, log in and call /me from, without writing a line of documentation.
---

[The API as a value](/learn/http-auth-api/01-the-api-as-a-value) described the
whole service as a value, and so far only the server has read it. The compiler
used it to check the handlers. Nothing else has touched it.

That value knows every path, every method, every field of every payload, every
success shape and every failure with its status. That is most of a
documentation page already, and none of it needs writing twice.

## The format in the middle

The bridge is **OpenAPI**, a standard way of describing an HTTP API as a JSON
document. It is what documentation pages, client generators and testing tools
all read. Effect generates it from the API value, so it is never out of date
with the server: both come from the same declaration.

Ask for it by naming a path when the API is built.

```ts
// src/main.ts, one new option on the ApiLive from the last chapter
const ApiLive = HttpApiBuilder.layer(AuthApi, {
  openapiPath: '/openapi.json',
}).pipe(/* the same provides as before, unchanged */)
```

Visit that path and there is the whole service as JSON. Useful to a machine,
unpleasant to a person.

## The page

**Scalar** renders that JSON as something readable, and it is one more layer.

```ts twoslash
import { Layer } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiScalar } from 'effect/unstable/httpapi'
import { Schema } from 'effect'

const AuthApi = HttpApi.make('AuthApi').add(
  HttpApiGroup.make('auth').add(
    HttpApiEndpoint.get('me', '/me', { success: Schema.String }),
  ),
)
// ---cut---
// src/main.ts
const DocsLive = HttpApiScalar.layer(AuthApi, { path: '/docs' })
//    ^?
```

It goes next to the API layer in the line that serves them:

```ts twoslash
import { Layer, Schema } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiScalar,
} from 'effect/unstable/httpapi'
import { BunHttpServer } from '@effect/platform-bun'

const AuthApi = HttpApi.make('AuthApi').add(
  HttpApiGroup.make('auth').add(
    HttpApiEndpoint.get('me', '/me', { success: Schema.String }),
  ),
)

const AuthHandlers = HttpApiBuilder.group(AuthApi, 'auth', (handlers) =>
  handlers.handle('me', () => Layer.launch as never),
)

const ApiLive = HttpApiBuilder.layer(AuthApi, {
  openapiPath: '/openapi.json',
}).pipe(Layer.provide(AuthHandlers))

const DocsLive = HttpApiScalar.layer(AuthApi, { path: '/docs' })
// ---cut---
// src/main.ts
const ServerLive = HttpRouter.serve(Layer.mergeAll(ApiLive, DocsLive)).pipe(
  Layer.provide(BunHttpServer.layer({ port: 3000, hostname: '127.0.0.1' })),
)
```

Restart, open `http://127.0.0.1:3000/docs`, and the page is there.
`HttpApiSwagger.layer` takes the same arguments and renders the same document
with a different look, if you prefer that one.

## Saying what things are for

Generated documentation with no prose in it is a list of shapes. The reader can
see that `/register` takes an email and a password. What they cannot see is
that the password rules exist, or that a second signup with the same address is
a 409 rather than an overwrite.

Annotations put that in, next to the thing they describe.

```ts twoslash
import { HttpApi, HttpApiGroup, OpenApi } from 'effect/unstable/httpapi'

const authGroup = HttpApiGroup.make('auth')
// ---cut---
// src/api.ts
const AuthApi = HttpApi.make('AuthApi')
  .add(authGroup)
  .annotate(OpenApi.Title, 'Auth API')
  .annotate(OpenApi.Version, '1.0.0')
  .annotate(
    OpenApi.Description,
    'Register an account, log in for a token, and read your own profile.',
  )
```

Endpoints and groups take the same `annotate` method, so a sentence explaining
the 409 lives on the endpoint that returns it. This is the cheapest
documentation you will ever write, because it sits in the file people are
already editing when they change the behaviour.

## The button that makes it worth it

`/me` needs a token, and a documentation page that cannot send one is a
brochure.

It can. The middleware declared
`security: { bearer: HttpApiSecurity.bearer }`, and that declaration was never
only for the server. It is part of the API value, so it reaches the OpenAPI
document, so Scalar knows this endpoint takes a bearer token and renders an
Authorize button for it.

Nothing extra is needed to switch that on. Declaring the middleware did it.

The whole service is now usable from one page:

1. Open `/docs`.
2. Find `POST /register`, send a name, an email and a password. A 201 comes
   back with your new user, and no password hash in it.
3. Try it again with a password like `abc` and read the 400. All three rules
   come back at once, which is the validation from
   [email and password](/learn/http-auth-api/02-email-and-password) and the fix
   from [hashing the password](/learn/http-auth-api/04-hashing-the-password)
   arriving together.
4. Send `POST /login` with the same details and copy the token out of the
   response.
5. Click Authorize, paste the token.
6. Send `GET /me`. Your user comes back.
7. Click Authorize again, clear the token, and send `GET /me` once more. 401.

Seven steps, no `curl`, and every one of them is exercising the real server.

## What people get wrong

Adding the docs layer, seeing a page appear, and stopping. An unannotated page
lists endpoints in the vocabulary of whoever named the schemas, which is fine
for the person who named them and no use to anyone else. The annotations are
the chapter, not the layer.

The other one is treating the generated document as something to save and hand
around. It is derived. Committing a copy creates a second version that starts
drifting the moment somebody changes an endpoint, which is exactly the problem
generating it was meant to remove.

## Where this leaves you

The service is about two hundred lines. It validates input and explains what it
rejected, stores no password anywhere, hands out a token nobody can forge,
refuses a request without one, and cannot return a password hash even by
mistake. Each of those is a property of a type or a declaration rather than a
rule somebody has to keep following.

Three things are worth doing next.

The [Fullstack Monorepo](/learn/fullstack-monorepo) track takes the same API
value and derives a typed client from it, so a frontend calls `login` without
anyone writing a URL or a fetch.

Testing is the gap this track left. `HttpApiTest` runs the real handlers with
no socket and no port, and swapping the repository layer decides what the
database is. [Effect-native testing](/learn/basic-effect/09-testing) covers the
approach on a smaller service.

And the [anti-patterns](/learn/anti-patterns) track collects the habits that
quietly undo all of this, which is a faster read once you have built something
that does it right.
