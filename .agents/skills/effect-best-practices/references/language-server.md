# Effect Language Server Reference

The Effect Language Service is a TypeScript language plugin that provides Effect-specific diagnostics, completions, refactors, and hover information. It catches errors that TypeScript alone cannot detect.

## Installation

Pick the package by TypeScript version. Effect v4 itself needs TypeScript 5.9 or newer and
recommends TypeScript 7.

| TypeScript | Package | CLI binary |
|------------|---------|------------|
| 7.0 or newer | `@effect/tsgo`, a wrapper around TypeScript-Go that embeds the Effect language service | `effect-tsgo` |
| 5.9 and 6.x | `@effect/language-service`, a `tsserver` plugin | `effect-language-service` |

Both support Effect v4. The `@effect/language-service` README tells TypeScript 7 users to
switch to `@effect/tsgo`.

### TypeScript 7 with @effect/tsgo

```bash
npm install @effect/tsgo --save-dev
# Interactive setup. Add --help to see the non-interactive flags
npx @effect/tsgo setup
```

`setup` adds the dependency, edits `tsconfig.json`, and can configure VS Code, Neovim, or
Emacs (`--vscode`, `--nvim`, `--emacs`). You still need a native TypeScript install next to
it (`typescript` >= 7, or an alias such as `@typescript/native`). Use `effect-tsgo` instead of
the official `tsgo` binary, not alongside it. `npx effect-tsgo get-exe-path` prints the
executable path for editors that need one.

### TypeScript 5.9 and 6 with @effect/language-service

```bash
npm install @effect/language-service --save-dev
```

Then use your workspace TypeScript in the editor:

- VS Code: F1, "TypeScript: Select TypeScript Version", "Use Workspace Version".
- JetBrains: Settings, Languages & Frameworks, TypeScript, pick the workspace
  `node_modules/typescript`.

### tsconfig.json

The plugin **name** is `@effect/language-service` for both packages:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "@effect/language-service" }]
  }
}
```

## Configuration Options

Options go on the plugin entry. In the `@effect/tsgo` schema, `refactors`, `diagnostics`,
`quickinfo`, `completions`, `goto`, and `renames` are plain booleans (all default to `true`). Per-rule severity lives in
`diagnosticSeverity`:

```json
{
  "compilerOptions": {
    "plugins": [{
      "name": "@effect/language-service",
      "diagnostics": true,
      "diagnosticSeverity": {
        "floatingEffect": "error",
        "strictEffectProvide": "warning",
        "deterministicKeys": "error"
      }
    }]
  }
}
```

Severity values are `off`, `error`, `warning`, `message`, and `suggestion`.
`"diagnosticSeverity": {}` keeps every rule at its default. Other options in the
`@effect/tsgo` schema:

| Option | Purpose |
|--------|---------|
| `overrides` | Ordered per-file option overrides, each with `include` globs and `options` |
| `includeSuggestionsInTsc` | Show suggestion-level diagnostics in `tsc` output (default `true`) |
| `ignoreEffectSuggestionsInTscExitCode` | Suggestions do not affect the `tsc` exit code (default `true`) |
| `ignoreEffectWarningsInTscExitCode` | Warnings do not affect the exit code (default `false`) |
| `ignoreEffectErrorsInTscExitCode` | Errors do not affect the exit code (default `false`) |
| `keyPatterns` | Array of `{ target, pattern, skipLeadingPath }` for the `deterministicKeys` rule |
| `namespaceImportPackages`, `barrelImportPackages`, `importAliases` | Import style preferences |
| `allowedDuplicatedPackages` | Packages allowed to appear in several versions |
| `pipeableMinArgCount` | Threshold for `missedPipeableOpportunity` (default `2`) |
| `effectFn` | Which `effectFnOpportunity` quick fix variants are offered (default `["span"]`) |
| `mermaidProvider`, `noExternal`, `layerGraphFollowDepth` | Layer graph hover links |

`@effect/language-service` has the same core options plus a few of its own, such as
`quickinfoEffectParameters` and `quickinfoMaximumLength`. Its README is the reference for the
version you installed. A rule's severity can also be set in code:

```ts
// @effect-diagnostics effect/floatingEffect:off
Effect.succeed(1) // not reported

// @effect-diagnostics *:off
```

### Diagnostics

Rule names below come from the `@effect/tsgo` 0.47 plugin schema. Defaults are from the
README tables of both packages. Run `npx effect-tsgo config` (or `effect-language-service
config`) to pick severities interactively.

| Diagnostic | Default | Description |
|------------|---------|-------------|
| `floatingEffect` | error | Effect value that is neither yielded nor assigned |
| `missingEffectContext` | error | Effect with service requirements that are not provided |
| `missingEffectError` | error | Effect with error types that are not handled |
| `missingLayerContext` | error | Layer with unprovided requirements |
| `missingStarInYieldEffectGen` | error | Bare `yield` instead of `yield*` in a generator |
| `missingReturnYieldStar` | error | Suggests `return yield*` for effects that never succeed |
| `classSelfMismatch` | error | `Self` type parameter does not match the class name |
| `outdatedApi` | warning | API removed or renamed in Effect v4 |
| `multipleEffectProvide` | warning | Chained `Effect.provide` calls |
| `leakingRequirements` | suggestion | Implementation services leaked through service methods |
| `effectFnOpportunity` | suggestion | Function returning an Effect that could use `Effect.fn` |
| `unnecessaryEffectGen` | suggestion | `Effect.gen` with a single return |
| `unnecessaryPipe` | suggestion | `pipe` call with no arguments |
| `strictEffectProvide` | off | `Effect.provide` outside application entry points |
| `serviceNotAsClass` | off | `Context.Service` declared as a variable instead of a class |
| `deterministicKeys` | off | Service, tag, and error identifiers that do not follow the key pattern |
| `globalConsole`, `globalDate`, `globalRandom`, `globalFetch`, `globalTimers`, `processEnv` | off | Native globals used where an Effect service exists (each has an `...InEffect` variant) |

`outdatedApi` is the useful one when migrating code from earlier Effect releases.

### Refactors and Completions

Refactors include `asyncAwaitToGen`, `asyncAwaitToFn` (and `...TryPromise` variants),
`effectGenToFn`, `wrapWithEffectGen`, `removeUnnecessaryEffectGen`, `layerMagic`,
`togglePipeStyle`, `pipeableToDatafirst`, `toggleReturnTypeAnnotation`,
`toggleTypeAnnotation`, and `typeToEffectSchema`.
Completions cover `Effect.gen(function*(){})`, class `Self` snippets for Schema and service
map classes, and `@effect-diagnostics` directive comments.

## CLI Tools

`@effect/tsgo` ships `setup`, `config`, `patch`, `unpatch`, `get-exe-path`, and
`diagnostics`. The `effect-language-service` CLI has those plus `check`, `codegen`,
`quickfixes`, `overview`, and `layerinfo`. Run it with `npx`, and prefer a local install so
it loads the same TypeScript as your project.

### Build-Time Diagnostics

Patch the installed TypeScript so `tsc` reports Effect diagnostics:

```bash
npx effect-tsgo patch      # or: npx effect-language-service patch
npx effect-tsgo unpatch    # restore
```

Errors such as a floating Effect then fail the build, unless an `ignoreEffect*InTscExitCode`
option says otherwise. `effect-tsgo patch` looks for `typescript`, then `@typescript/native`.
Pass `--typescript-package <name>` to try another package name first.

### Project-Wide Diagnostics

Run the diagnostics without patching:

```bash
npx effect-tsgo diagnostics --project tsconfig.json
npx effect-tsgo diagnostics --project tsconfig.json --format github-actions --strict
```

`--format` accepts `json`, `pretty`, `text`, and `github-actions`. `--strict` treats warnings
as errors, and `--severity error,warning` filters the output.

### Classic CLI Extras

```bash
npx effect-language-service quickfixes --project tsconfig.json  # preview available fixes
npx effect-language-service codegen --project tsconfig.json     # apply @effect-codegens directives
npx effect-language-service overview --project tsconfig.json    # Effect exports in the project
npx effect-language-service layerinfo --file src/layers.ts --name AppLive  # layer composition help
```

## Common Diagnostics

### Floating Effect

```typescript
// ERROR: Effect is created but never used
Effect.succeed(42)

// FIX: Use yield* or pipe to runPromise
yield* Effect.succeed(42)
// or
await Effect.runPromise(Effect.succeed(42))
```

### Missing Requirements

```typescript
// ERROR: UserService is required but not provided
const program = Effect.gen(function* () {
  const users = yield* UserService
  return yield* users.findById(id)
})
// FIX: Provide the service's layer
const main = program.pipe(Effect.provide(UserService.layer))
```

### Missing yield star

```typescript
// ERROR: bare yield does not run the Effect
const a = yield Effect.succeed(42)

// FIX
const b = yield* Effect.succeed(42)
```

### Outdated API

`outdatedApi` flags APIs that were removed or renamed in Effect v4. Follow its message to the
replacement, and see `v4-semantics.md` for the semantics that changed.

## Troubleshooting

### Language Service Not Loading

1. Ensure the package is in devDependencies. For `@effect/language-service`, also ensure
   `typescript` is installed locally and the editor uses the workspace version.
2. Restart the TypeScript server (VSCode: Cmd+Shift+P, "TypeScript: Restart TS Server").
3. For `@effect/tsgo`, run `npx @effect/tsgo setup` again and check that the editor runs
   `effect-tsgo` and not the stock `tsgo`.

### Diagnostics Not Appearing

1. Check the `tsconfig.json` plugin entry, and that its `name` is `@effect/language-service`.
2. Ensure the file is included in the TypeScript project.
3. Check for `"diagnostics": false` or a `diagnosticSeverity` entry set to `"off"`.
4. In `tsc` runs, diagnostics only appear after `patch`. Delete `tsbuildinfo` files or do a
   full rebuild so previously checked files are re-checked.

### Performance Issues

Set rules you do not need to `"off"` in `diagnosticSeverity`, or set `"diagnostics": false`:

```json
{
  "compilerOptions": {
    "plugins": [{
      "name": "@effect/language-service",
      "diagnosticSeverity": {
        "multipleEffectProvide": "off",
        "missedPipeableOpportunity": "off"
      }
    }]
  }
}
```
