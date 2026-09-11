# Learning Effect

A small site that teaches the [Effect](https://effect.website) library for
TypeScript. The content is markdown in `content/`, and every snippet marked
`twoslash` is compiled by the build, so an example that does not typecheck
fails the build instead of reaching a reader.

```bash
bun install
bun run dev
```

## How it fits together

`content/` holds one folder per track, each with an `index.md` and its
chapters. `content/themes.json` groups the tracks into the sections the home
page renders. Nothing is registered anywhere: `vite-plugin-markdown.ts` turns
each file into a module at build time, `src/content.ts` assembles them into
themes and tracks, and the routes read from there.

The plugin also counts reading time, so no page carries an authored minutes
figure, and it runs twoslash and shiki over the code fences. Mermaid loads
only on pages that actually contain a diagram, because it is around half a
megabyte.

## Adding things

Adding a **chapter** is dropping a `.md` file into a track folder. Adding a
**track** is making a folder with an `index.md` in it, naming a theme from
`themes.json`. Adding a **theme** is one line in `themes.json`.

`scripts/chapter-template.md` is a chapter skeleton worth copying.
[CONTENT.md](CONTENT.md) is the full guide: the frontmatter fields, the prose
rules, how to write a compiled snippet, and how to draw a diagram that
survives the escaping.

## Commands

```bash
bun run dev            # dev server on :3000
bun run build          # production build, compiles every snippet
bun run check:content  # render all content and enforce the writing rules
bun run test           # vitest
bun run check          # biome
```

`check:content` is the one to run before committing prose. It renders every
page, fails on a snippet that does not compile and names the block that broke,
and enforces the rules that can be checked: no em dashes, every chapter
leaving the reader something runnable, no link pointing at a page that does
not exist, no track naming a theme that is not in `themes.json`.

## Stack

Vite, React and TanStack Router with file-based routes, Tailwind, and
[base-ui](https://base-ui.com) components via shadcn. Biome for lint and
format, vitest for tests, bun as the runtime.
