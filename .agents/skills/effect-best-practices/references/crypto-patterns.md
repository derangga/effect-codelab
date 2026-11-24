# Crypto Patterns

> **Effect 4.1.** `effect/crypto` ships hashing, HMAC, authenticated encryption, signatures, key
> derivation, key agreement, key wrapping, and secure randomness as services. Each family is a
> `Context.Service` with a `layerWebCrypto` layer that runs on `crypto.subtle`. The whole subpath is
> `@stability unstable`, so a minor release can break it. Pin an exact `effect` version when crypto
> is on a critical path. Do not import `node:crypto` for these jobs.

## Imports and Layers

```typescript
import { Aead, Digest, Kdf, Mac, SecureRandom, Signature, CryptoError } from "effect/crypto"
```

| Service | Does | Core layer | Needs |
| --- | --- | --- | --- |
| `SecureRandom` | random bytes, integers, shuffle, UUIDv4, UUIDv7, ULID | `SecureRandom.layerWebCrypto` | nothing |
| `Digest` | MD5, SHA-1, SHA-256, SHA-384, SHA-512 | `Digest.layerWebCrypto` | nothing |
| `Mac` | HMAC with SHA-1, SHA-256, SHA-384, SHA-512 | `Mac.layerWebCrypto` | `SecureRandom` |
| `Aead` | AES-GCM, ChaCha20-Poly1305, XChaCha20-Poly1305 | `Aead.layerWebCrypto` | `SecureRandom` |
| `Signature` | Ed25519, ECDSA P-256/384/521, RSA-PSS, RSA PKCS#1 v1.5 | `Signature.layerWebCrypto` | `SecureRandom` |
| `Kdf` | HKDF, PBKDF2, Argon2id | `Kdf.layerWebCrypto` | nothing |
| `KeyAgreement`, `KeyWrap`, `Cipher` | X25519 and ECDH, AES-KW and RSA-OAEP, AES-CTR and AES-CBC | `layerWebCrypto` on each | `SecureRandom` |

Since 4.1.0, crypto is **not** part of the runtime `*Services` bundles (`NodeServices` and the
others carry no crypto service). Provide it explicitly. Each platform package exports one module
with a layer per family and a combined `layer`. Every one of those layers supplies its own
`SecureRandom`, so the combined layer has no requirements:

```typescript
import { NodeCrypto } from "@effect/platform-node"   // BunCrypto, DenoCrypto, BrowserCrypto likewise

const CryptoLive = NodeCrypto.layer // SecureRandom | Digest | Mac | Kdf | Aead | Cipher | Signature | KeyAgreement | KeyWrap
```

The Node layers use `node:crypto` for `Digest`, `Mac`, and `Aead` ChaCha20-Poly1305. Argon2id is
available from `NodeCrypto.layerKdf` when the runtime has an Argon2 engine, and from
`BunCrypto.layerKdf` on Bun 1.4 or newer. The core `Kdf.layerWebCrypto` and older runtimes fail
Argon2id with an `Unsupported` reason, so fall back to PBKDF2 where it matters. In a browser, `crypto.subtle`
exists only in secure contexts. Elsewhere the SHA digests die, while `SecureRandom` and MD5 keep
working.

The `WebCrypto` reference (`effect/crypto/WebCrypto`) defaults to `globalThis.crypto`. Provide
`WebCrypto.layer(cryptoObject)` to run on a polyfill, a worker's object, or a test double. A
`CryptoKey` passed to `fromCryptoKey` must come from that same object.

## SecureRandom: Tokens, IDs, and Dice

Use `SecureRandom` for anything an attacker must not guess. `effect/Random` and `Math.random` are
not secure.

```typescript
const program = Effect.gen(function* () {
    const random = yield* SecureRandom.SecureRandom

    const sessionToken = yield* random.randomBytes(32)
    const id = yield* random.uuidV7()               // sorts after the previous one from this service
    const trace = yield* random.ulid
    const roll = yield* random.intBetween(1, 6)     // uniform, both ends inclusive
    const order = yield* random.shuffle(["a", "b", "c"])
})
```

- Every operation has a `never` error channel. A bad size or an empty range is a defect.
- `uuidV7` and `ulid` sort after the previous value from the same service, including within a
  millisecond and across a clock rollback. There is no ordering between services, processes, or
  workers. They reveal generation order, so never use them as secrets.
- `{ format: "bytes" }` returns the 16 UUID bytes.
- The `*Unsafe` helpers draw synchronously from `globalThis.crypto`. Use them only where a service
  cannot reach, such as a model default or a constructor.

## Digest: Hashing

```typescript
const fingerprint = (bytes: Uint8Array) =>
    Effect.gen(function* () {
        const digest = yield* Digest.Digest
        return yield* digest.digestHex(Digest.sha256, bytes) // lowercase hex
    })
```

`digest` returns the raw `Uint8Array`. Output is stable byte for byte, so digests can be stored.
MD5 and SHA-1 are broken for collision resistance. Use them only to match an existing protocol or
checksum. Never hash passwords with `Digest`. Use `Kdf`.

## Mac: Signing and Verifying Payloads

```typescript
export class TokenSigner extends Context.Service<TokenSigner>()("TokenSigner", {
    make: Effect.gen(function* () {
        const mac = yield* Mac.Mac
        // Config.schema reads the bytes as base64
        const key = yield* Config.schema(Schema.MacKeyFromBytes(Mac.hmacSha256), "TOKEN_HMAC_KEY")
        const encode = (s: string) => new TextEncoder().encode(s)

        const sign = Effect.fn("TokenSigner.sign")((payload: string) =>
            mac.sign(key, encode(payload))
        )
        // Constant time. A wrong tag, or a tag of the wrong length, is `false`, not an error.
        const verify = Effect.fn("TokenSigner.verify")((payload: string, tag: Uint8Array) =>
            mac.verify(key, tag, encode(payload))
        )
        return { sign, verify }
    }),
}) {
    static readonly layer = Layer.effect(this, this.make).pipe(
        Layer.provide(Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto)))
    )
}
```

Always check tags with `mac.verify`. If you must compare two byte arrays by hand, use
`Mac.timingSafeEqual(a, b)`. A plain `===` or a byte loop that exits early leaks timing. A key can
come from `mac.generateKey(Mac.hmacSha256)`, from `Mac.key(algorithm, bytes)`, or from a
non-extractable `CryptoKey` through `Mac.fromCryptoKey`.

## Aead: Encrypting Data at Rest

`Aead` encrypts and authenticates in one step. The ciphertext is `ciphertext‖tag` with a 16-byte
tag. A modified ciphertext, tag, nonce, or `aad` fails with a `DecryptionFailed` reason that carries
no detail, so the failure does not tell an attacker which part was wrong.

```typescript
const seal = Effect.fn("Vault.seal")(function* (key: Aead.Key, plaintext: Uint8Array, aad: Uint8Array) {
    const aead = yield* Aead.Aead
    const random = yield* SecureRandom.SecureRandom
    const nonce = yield* random.randomBytes(24) // XChaCha20-Poly1305 nonce
    const sealed = yield* aead.encrypt(key, plaintext, { nonce, aad })
    const out = new Uint8Array(nonce.length + sealed.length)
    out.set(nonce)
    out.set(sealed, nonce.length)
    return out // store the nonce next to the ciphertext
})

const open = Effect.fn("Vault.open")(function* (key: Aead.Key, stored: Uint8Array, aad: Uint8Array) {
    const aead = yield* Aead.Aead
    return yield* aead.decrypt(key, stored.slice(24), { nonce: stored.slice(0, 24), aad })
})
```

Pick the algorithm by nonce size:

| Algorithm | Nonce | Random nonces |
| --- | --- | --- |
| `Aead.xchacha20Poly1305` | 24 bytes | Safe. Use this by default. |
| `Aead.aes256Gcm`, `Aead.aes128Gcm` | 12 bytes | Collision risk after about 2^32 messages under one key. Use a counter. |
| `Aead.chacha20Poly1305` | 12 bytes | Same limit as AES-GCM. |

Never reuse a nonce with the same key. Bind the ciphertext to its row by passing the row id as
`aad`, so a ciphertext cannot be moved to another record. `Aead.fromCryptoKey` builds an AES-GCM key
from a non-extractable `CryptoKey`. The ChaCha algorithms run in pure TypeScript on the core layer,
so they cannot be `CryptoKey`s.

## Signature, Kdf, and the Rest

```typescript
// Sign and verify with Ed25519
const { privateKey, publicKey } = yield* signature.generateKeyPair(Signature.ed25519)
const signed = yield* signature.sign(privateKey, data)
const ok = yield* signature.verify(publicKey, signed, data) // bad signature bytes are `false`, not an error
```

`verify` fails only for problems with the key or the layer. Any problem with the signature bytes,
such as a wrong length, returns `false`. Load keys from PEM, JWK, SPKI, or PKCS#8 with
`KeyFormat.decodePublic`, `decodePrivate`, and `decodeSecret`. They are plain functions that run on
the `WebCrypto` reference and need no service.

**Password hashing and key derivation** use `Kdf`:

```typescript
const hashPassword = Effect.fn("Auth.hashPassword")(function* (password: string) {
    const kdf = yield* Kdf.Kdf
    const random = yield* SecureRandom.SecureRandom
    const salt = yield* random.randomBytes(16)
    const hash = yield* kdf.derive(Kdf.pbkdf2Sha256, new TextEncoder().encode(password), {
        salt,
        length: 32,
    })
    return { salt, hash }
})

// Verify by deriving again with the stored salt, then compare in constant time
const matches = Mac.timingSafeEqual(derived, stored.hash)
```

`Kdf.pbkdf2Sha256` defaults to 600,000 iterations. `Kdf.argon2id({ memory, passes, parallelism })`
needs a platform `layerKdf` with an Argon2 engine. Elsewhere it fails with `Unsupported`, so catch that reason and fall back to PBKDF2. `info` applies only to HKDF and fails with `InvalidArgument` for the
others. A shared secret from `KeyAgreement` is plain bytes: pass it through `Kdf.hkdfSha256` before
using it as a key.

`Cipher` (AES-CTR and AES-CBC) has no integrity. Use it only to match a protocol that pairs it
with a MAC, and authenticate with `Mac` (encrypt, then MAC). For new code use `Aead`. `KeyWrap`
(AES-KW and RSA-OAEP) wraps `Aead`, `Cipher`, `Mac`, and `KeyWrap` keys, never raw bytes.

## Errors

Every operation fails with `CryptoError`, a `Data.TaggedError` carrying `module`, `method`, and a
`reason`. Reasons are `InvalidArgument`, `InvalidKey`, `DecryptionFailed`, `Unsupported`, and
`NotExtractable`. Separate caller mistakes from tampering with `catchReason`:

```typescript
const readSecret = open(key, stored, aad).pipe(
    Effect.catchReason("CryptoError", "DecryptionFailed", () =>
        Effect.fail(new SecretTamperedError({ message: "Stored secret failed authentication" }))
    ),
    // Any other CryptoError here is our bug: wrong key length, bad argument
    Effect.catchTag("CryptoError", (e) => Effect.die(e))
)
```

Map `CryptoError` to your own domain error at the service boundary, as described in
`error-patterns.md`. Do not let it reach an HTTP response, where the reason text is internal detail.

## Keys

- **Keys are opaque.** They display redacted, compare by reference, and have no `Arbitrary`. Do not
  log, spread, or compare them. Export bytes only through `toBytes`, which fails with
  `NotExtractable` for a non-extractable `CryptoKey`.
- **Prefer non-extractable keys in the browser.** Build them with `fromCryptoKey` on a key
  generated by `crypto.subtle`, so script injection cannot read the bytes.
- **Config and schemas.** `Schema.MacKeyFromBytes`, `AeadKeyFromBytes`, `CipherKeyFromBytes`,
  `SignaturePublicKeyFromBytes`, and `SignaturePrivateKeyFromBytes` decode raw bytes into keys. The
  `FromFormat` variants decode PEM, JWK, SPKI, or PKCS#8. Under `Config.schema` the bytes are read
  as base64. **Encoding a secret or private key fails with a `Forbidden` issue** unless you pass
  `{ allowEncode: true }` as the last argument, so a key cannot leak through a response schema by
  accident.

## Testing

`effect/testing/TestCrypto` is gone since 4.1.0. Use the real `Digest`, `Mac`, `Aead`, and
`Signature` layers in tests. They are deterministic for fixed keys and inputs. Replace only
`SecureRandom` when a test needs fixed nonces or IDs, and use `Layer.mock` for it:

```typescript
const FixedRandom = Layer.mock(SecureRandom.SecureRandom, {
    randomBytes: (size) => Effect.succeed(new Uint8Array(size).fill(7)),
})
```

Members you leave out fail with an unimplemented defect when called, which flags a test that
uses more randomness than you meant to fix.

## Migration From 4.0

The single `effect/Crypto` module is gone. Randomness and UUIDs now live in `SecureRandom`, and
hashing in `Digest` with an algorithm value (`Digest.sha256`). `SqlMessageStorage` and
`SingleRunner` now require `Digest.Digest` in place of `Crypto.Crypto`. Event log encryption runs
on `Aead`, `Digest`, `Signature`, and `SecureRandom`.

## Anti-Patterns

```typescript
// FORBIDDEN: Math.random or effect/Random for tokens and IDs
const token = Math.random().toString(36)            // Use SecureRandom.randomBytes

// FORBIDDEN: comparing MACs or hashes with ===
if (computedTag.toString() === tag.toString()) ...  // Use mac.verify or Mac.timingSafeEqual

// FORBIDDEN: a fixed or repeated nonce
aead.encrypt(key, data, { nonce: new Uint8Array(12) }) // Fresh random nonce per message

// FORBIDDEN: a bare hash for passwords
digest.digestHex(Digest.sha256, password)           // Use Kdf.pbkdf2Sha256 or Kdf.argon2id

// FORBIDDEN: Cipher without a MAC
cipher.encrypt(key, data, { iv })                   // Use Aead

// FORBIDDEN: node:crypto directly inside services
import { createHmac } from "node:crypto"            // Use Mac, swap the layer per platform
```
