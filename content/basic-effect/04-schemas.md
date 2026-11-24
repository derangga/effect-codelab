---
title: Schemas and domain modeling
order: 4
slug: 04-schemas
summary: Describe a value once to get its type, its validation, and its decoder. Then brand ids so the compiler no longer treats every string as the same.
---

This signature does not say which values are valid.

```ts twoslash
interface Product { readonly id: string }
// ---cut---
declare function createProduct(name: string, price: number): Product
```

It accepts an empty name, a price of `-5`, and a price of `NaN`. `NaN` is a
`number` too. Input from a request body is worse. You do not have a `string`
and a `number` there. You have `unknown`. Most codebases turn that into a type
with a cast, and nothing checks the cast.

A schema is one declaration that fixes all of this. It gives you the TypeScript
type, the runtime validation, and a decoder that turns untrusted input into a
typed value. The three cannot drift apart, because they come from the same
declaration.

From here the course leaves `fetch` and `index.ts` behind. The catalog lives in
memory. The module you build in this chapter and the next four goes in a new
file, `product.ts`. A code block that opens with a file name belongs in that
file. A block without a file name is an illustration to read. Each block shows
the imports it uses. If your file already imports a name, add it to the
existing import line instead of pasting a second one. The end of this chapter
shows the file as it should look.

## Describing a value

```ts twoslash
// product.ts
import { Schema } from 'effect'
const Product = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  price: Schema.Finite,
})

type Product = Schema.Schema.Type<typeof Product>
```

`Product` now names two things on purpose. The value is the schema, which you
can use at runtime. The type is what TypeScript sees. Declare the type with
`Schema.Schema.Type` instead of writing an interface. Then the type changes
whenever a field changes.

Use `Schema.Finite` instead of `Schema.Number`. `Schema.Number` admits `NaN` and
`Infinity`, so a price of `NaN` would pass and cause a bug later.

## Checks narrow what is allowed

A check is a predicate attached to a schema. It is a function that returns true
for the values the schema accepts.

```ts twoslash
// product.ts, above Product
import { Schema } from 'effect'
const ProductName = Schema.String.check(Schema.isMinLength(1))
const ProductPrice = Schema.Finite.check(Schema.isGreaterThan(0))
```

Put checks on the field schemas, not on the struct. Naming a field schema such as `ProductName` lets you reuse it and read it. Every struct that uses it gets the rule, and
you write the rule once.

```ts twoslash
const ProductName = Schema.String.check(Schema.isMinLength(1))
const ProductPrice = Schema.Finite.check(Schema.isGreaterThan(0))
// ---cut---
// product.ts, replacing Product
import { Schema } from 'effect'
const Product = Schema.Struct({
  id: Schema.String,
  name: ProductName,
  price: ProductPrice,
})
```

Checks run when a value is decoded. They do not make the compiler reject an
invalid object literal that you write by hand, and they are not meant to. Use
them at the boundary. The boundary is where values you did not create enter
your program.

## Branded ids

With `id: Schema.String`, the compiler still accepts any string as a product
id. A brand fixes that without changing the runtime value.

```ts twoslash
// product.ts, above Product
import { Schema } from 'effect'
const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
type ProductId = Schema.Schema.Type<typeof ProductId>
```

At runtime, a `ProductId` is a string. It has no wrapper and no extra cost. At
compile time, it is `string & Brand<'@Catalog/ProductId'>`, and no plain string
matches that type. If you pass a raw string where a `ProductId` is expected, the
call does not compile.

The namespace prefix stops two brands from clashing. If two modules both brand
`'ProductId'`, they produce the same type. The compiler then accepts one
module's id where the other's is expected, which is the mistake branding exists
to prevent.

`ProductId.make(value)` is the constructor. Use it for values you already know
are ids, such as fixtures and seeds. Decode anything that arrived from outside instead. The "Decoding unknown input"
section shows how.

## Separate schemas for stored and new products

A product that exists and a request to create one have different shapes. Give
each its own schema.

```ts twoslash
const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
const ProductName = Schema.String.check(Schema.isMinLength(1))
const ProductPrice = Schema.Finite.check(Schema.isGreaterThan(0))
// ---cut---
// product.ts, replacing Product, with CreateProduct below it
import { Schema } from 'effect'
const Product = Schema.Struct({
  id: ProductId,
  name: ProductName,
  price: ProductPrice,
})
type Product = Schema.Schema.Type<typeof Product>

const CreateProduct = Schema.Struct({
  name: ProductName,
  price: ProductPrice,
})
type CreateProduct = Schema.Schema.Type<typeof CreateProduct>
```

`CreateProduct` has no id, because the caller does not have one yet. Whatever
stores the product assigns the id. Suppose you modelled both shapes with one
type that has an optional id. Then every read of `product.id` would have to
handle a missing id, and a stored product never lacks one.

Both schemas use `ProductName` and `ProductPrice`. The rule that a price is
positive is written once and applies to both.

## Decoding unknown input

`Schema.decodeUnknownEffect` turns a schema into a function from `unknown` to an
Effect.

```ts twoslash
const ProductName = Schema.String.check(Schema.isMinLength(1))
const ProductPrice = Schema.Finite.check(Schema.isGreaterThan(0))
const CreateProduct = Schema.Struct({
  name: ProductName,
  price: ProductPrice,
})
// ---cut---
import { Schema } from 'effect'
const decodeCreateProduct = Schema.decodeUnknownEffect(CreateProduct)

const parsed = decodeCreateProduct({ name: 'Desk mat', price: 30 })
//    ^?
```

Here the error channel is `SchemaError`.
It says what failed and where, not just that something failed. Success gives
you a `CreateProduct`. Once you hold one, the name is non-empty and the price
is positive. Nothing later has to check again.

The decoder is the one place `unknown` should appear. Decode at the edge, where
a request body or a file arrives, and pass typed values inward.

Code that takes a `CreateProduct` cannot receive an invalid product. This is why
none of the service methods later in the course have `SchemaError` in their
signatures.

## Optional fields with Option

Some fields may be absent. Model the absence instead of leaving a `null` or an
`undefined` in the type. `Schema.OptionFromOptionalKey` decodes a key that may
be missing from the input into an `Option`.

```ts twoslash
const ProductName = Schema.String.check(Schema.isMinLength(1))
// ---cut---
import { Schema } from 'effect'
const ProductDetails = Schema.Struct({
  name: ProductName,
  description: Schema.OptionFromOptionalKey(Schema.String),
})
type ProductDetails = Schema.Schema.Type<typeof ProductDetails>
```

`description` is an `Option<string>`. Input with no `description` key decodes to
`Option.none()`. Input with a string decodes to `Option.some`. To read it, you
must say what happens when it is absent, with `Option.match` or
`Option.getOrElse`. A null check is easy to skip, and you cannot see it in a
signature.

Do not use `Schema.Option(Schema.String)` here. It describes a value that is
already an `Option`. Decoding therefore rejects a plain string, a `null`, and a
missing key. If the input writes absence as `null`, as many JSON APIs do, use
`Schema.OptionFromNullOr(Schema.String)`.

## Common mistake: casting at the boundary

The most common mistake is to cast input at the boundary. Schemas replace this
habit, but it often survives because the cast still compiles.

```ts twoslash
import { Schema } from 'effect'
const ProductName = Schema.String.check(Schema.isMinLength(1))
const ProductPrice = Schema.Finite.check(Schema.isGreaterThan(0))
const CreateProduct = Schema.Struct({
  name: ProductName,
  price: ProductPrice,
})
type CreateProduct = Schema.Schema.Type<typeof CreateProduct>
declare const body: unknown
// ---cut---
const input = body as CreateProduct
```

No check ran. `as` tells the compiler what to believe. It does not verify
anything, so `input.price` can be `undefined` or `-5`. All the code after the
cast trusts a guarantee that nobody established. The failure then appears far
from the cast.

`ProductId.make(someRequestParam)` is the same mistake with a brand. The
constructor asserts that the value is already an id. On untrusted input, it
gives you the false confidence that branding should remove. Decode the value
instead.

The [boundary chapter in the anti-patterns track](/learn/anti-patterns/01-at-the-boundary)
covers this in more depth. It also covers two other ways a boundary leaks.

## Where product.ts stands

```ts twoslash
// product.ts
import { Schema } from 'effect'

export const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
export type ProductId = Schema.Schema.Type<typeof ProductId>

export const ProductName = Schema.String.check(Schema.isMinLength(1))
export const ProductPrice = Schema.Finite.check(Schema.isGreaterThan(0))

export const Product = Schema.Struct({
  id: ProductId,
  name: ProductName,
  price: ProductPrice,
})
export type Product = Schema.Schema.Type<typeof Product>

export const CreateProduct = Schema.Struct({
  name: ProductName,
  price: ProductPrice,
})
export type CreateProduct = Schema.Schema.Type<typeof CreateProduct>
```

The `export` keywords are new. The service chapters and the tests import from
this module, so it exports everything it defines.

## Next

You now have typed values, typed failures, and a way to build programs from
both. The catalog is still a set of loose functions. The next chapter,
[Design the product service](/learn/basic-effect/05-design), plans the shape
before any of it becomes a service. It decides what calls what, which failures
exist, and which part owns each failure.
