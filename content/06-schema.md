---
title: Schema
order: 6
slug: 06-schema
summary: Turning data you did not create into values you can trust, with the failure landing in the E channel.
---

Every program has a border. On one side is data you wrote and the compiler
checked. On the other side is data that arrived: a JSON response, a form
submission, a row from a database, something out of local storage.

TypeScript cannot see across that border. So people do this.

```ts twoslash
const response = await fetch('https://fakestoreapi.com/products/1')
const product = (await response.json()) as { title: string; price: number }

console.log(product.title.toUpperCase())
```

The cast is a promise you have no way to keep. If the server renames the field,
or sends `null`, or is down and a proxy returns an HTML error page, that last
line throws and the type said everything was fine.

`Schema` is how you check instead of promise.

## Describing the shape

A schema is a value that describes what data should look like.

```ts twoslash
import { Schema } from 'effect'

const Product = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  price: Schema.Number,
  category: Schema.String,
})
```

That is a normal value, not a type. You can pass it around, put it in an array,
export it from a module.

The type comes out of it when you ask.

```ts twoslash
import { Schema } from 'effect'
const Product = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  price: Schema.Number,
  category: Schema.String,
})
// ---cut---
type Product = typeof Product.Type
//   ^?
```

One definition, and both the runtime check and the type come from it. This is
the part worth holding on to. Writing an `interface` and a validator separately
means keeping two things in step by hand, and they drift the first time
somebody is in a hurry.

Schemas nest, because most real data does.

```ts twoslash
import { Schema } from 'effect'
// ---cut---
const Rating = Schema.Struct({
  rate: Schema.Number,
  count: Schema.Number,
})

const Product = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  price: Schema.Number,
  category: Schema.String,
  rating: Rating,
})

const Products = Schema.Array(Product)
```

## Decoding, and where the failure goes

`Schema.decodeUnknownEffect` takes a schema and gives you a function from
`unknown` to an Effect.

```ts twoslash
import { Schema } from 'effect'
const Product = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
})
declare const raw: unknown
// ---cut---
const decoded = Schema.decodeUnknownEffect(Product)(raw)
//    ^?
```

Look at what came back. The success channel is your product type. The failure
channel is `Schema.SchemaError`, and it is there because the compiler knows
decoding can fail. You did not write it down, and you cannot forget it.

This is chapter five's machinery doing its job on real input. Bad data is not a
crash and not a silent `null`. It is a failure with a name, sitting in `E`,
waiting for somebody to handle it.

Handle it the way you handle any other failure.

```ts twoslash
import { Effect, Schema } from 'effect'
const Product = Schema.Struct({ id: Schema.Number, title: Schema.String })
declare const raw: unknown
// ---cut---
const safe = Schema.decodeUnknownEffect(Product)(raw).pipe(
  Effect.catchTag('SchemaError', (error) =>
    Effect.succeed({ id: 0, title: `unreadable: ${error.message}` }),
  ),
)
```

`error.message` is a readable description of what was wrong and where. Log it.
It is the difference between "the request failed" and "the server sent a string
where the price should be".

Paste this into a file and run it to see both paths.

```ts twoslash
import { Effect, Schema } from 'effect'

const Product = Schema.Struct({ id: Schema.Number, title: Schema.String })

const read = (raw: unknown) =>
  Schema.decodeUnknownEffect(Product)(raw).pipe(
    Effect.map((product) => `ok: ${product.title}`),
    Effect.catchTag('SchemaError', (error) => Effect.succeed(`bad: ${error.message}`)),
  )

Effect.runSync(read({ id: 1, title: 'Backpack' })) // ok: Backpack
Effect.runSync(read({ id: '1', title: 'Backpack' }))
// bad: Expected number
//   at ["id"]
```

## Making it your own failure

`SchemaError` is a fine type, but it says "something did not decode" without
saying which thing. When a service does several decodes, wrap the failure in
an error of your own so the caller knows what was being read.

```ts twoslash
import { Effect, Schema } from 'effect'
const Product = Schema.Struct({ id: Schema.Number, title: Schema.String })
declare const raw: unknown
// ---cut---
class BadProduct extends Schema.TaggedError<BadProduct>()('BadProduct', {
  detail: Schema.String,
}) {}

const product = Schema.decodeUnknownEffect(Product)(raw).pipe(
  Effect.mapError((error) => new BadProduct({ detail: error.message })),
)
```

`Effect.mapError` changes the failure and leaves the success alone. The caller
now sees `BadProduct`, which they can match on alongside whatever else your
service can fail with, rather than a generic decoding error they would have to
guess the origin of.

Notice that `Schema.TaggedError` is the same tool from chapter five. Errors are
schemas too, which is why they can be sent over a network and read back on the
other side.

## Fields that might not be there

Two ways to say optional, and they mean different things.

```ts twoslash
import { Schema } from 'effect'
// ---cut---
const User = Schema.Struct({
  name: Schema.String,
  nickname: Schema.optionalKey(Schema.String),
  bio: Schema.optional(Schema.String),
})
```

`optionalKey` means the key may be missing. `optional` means the key may be
missing or present with the value `undefined`.

The difference shows up at the border, not in the type. Given
`{ name: 'a', nickname: undefined }`, `optionalKey` rejects it, saying it expected
a string at `nickname`, because the key is there and its value is not a string. `optional` accepts the same input. Servers that send
`{"bio": null}` need neither of those, they need `Schema.NullOr`. Pick the one
that matches what actually arrives, not what you wish arrived.

## Beyond shape

A schema can check values, not just types.

```ts twoslash
import { Schema } from 'effect'
// ---cut---
const Product = Schema.Struct({
  id: Schema.Number,
  title: Schema.String.check(Schema.isMinLength(1)),
  price: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
})
```

A negative price is the right shape and still wrong. Putting the rule in the
schema means it is checked at the border, once, instead of being rediscovered
by whichever screen renders it.

Do not go overboard. Check what you actually depend on. A schema that encodes
every business rule you have becomes a second place to change every time a rule
moves.

## Two types, not one

There is one more idea to know before the capstone, and it explains a name you
will meet.

A schema has a `Type` (what your code works with) and an `Encoded` (what the
outside world sends). They are usually the same, but not always.

```ts twoslash
import { Schema } from 'effect'
// ---cut---
const Port = Schema.NumberFromString

type PortType = typeof Port.Type
//   ^?
type PortEncoded = typeof Port.Encoded
//   ^?
```

Decoding goes from `Encoded` to `Type`, and encoding goes back. It is how a
date arrives as a string and reaches your code as a `Date`, without the
conversion being scattered around. You will not need it often. When you do, the
alternative is a helper called `parseWhatever` that half the codebase forgets to
call.

## Next

Chapter seven is about `R`, the third slot, which has been `never` in every
example so far. It is where the things your program needs, such as an HTTP
client or a config value, stop being global variables and start being
requirements the compiler tracks.
