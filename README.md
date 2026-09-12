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
page renders. Nothing is registered anywhere: Fumadocs reads the folder, and
ordering comes from the `01-` prefix on each filename.

Themes are the one thing that is not a folder. They live in frontmatter and
`themes.json`, so a loader plugin synthesizes them into the page tree, which
is what keeps `content/` flat.

The collection schema does the rest of the work up front, from the raw file
rather than from compiled output: reading time, the draft badge, and the
description under each title. That matters because the collection is async, so
anything read off compiled content would force all 28 chapters to compile just
to draw the sidebar.

The build prerenders every page to static html. There is no server: the two
server functions run at build time and their results are written next to the
html, so a reader clicking between chapters fetches json rather than calling
an endpoint. Search is a static index, built over the finished chapters and
searched in the browser. Mermaid loads only on pages that draw a diagram,
because it is around half a megabyte.

## Adding things

Adding a **chapter** is dropping a `.md` file into a track folder. Adding a
**track** is making a folder with an `index.md` in it, naming a theme from
`themes.json`. Adding a **theme** is one line in `themes.json`.

`scripts/chapter-template.md` is a chapter skeleton worth copying.
[CONTENT.md](CONTENT.md) is the full guide: the frontmatter fields, the prose
rules, how to write a compiled snippet, and how to draw a diagram that
survives the escaping. It marks which of its rules are checked and which are
judgement calls.

## Commands

```bash
bun run dev            # dev server on :3000
bun run build          # static build, compiles every snippet
bun run check:content  # the writing rules, over the markdown source
bun run test           # vitest
bun run lint           # oxlint
bun run types:check    # tsc
```

`check:content` is the one to run before committing prose. It reads the
markdown and enforces what can be enforced: no em dashes, every chapter
leaving the reader something runnable, no link pointing at a page that does
not exist, no track naming a theme that is not in `themes.json`, no order used
twice. It compiles nothing, so run `bun run build` for the snippets.

## Stack

Fumadocs on TanStack Start, built with Vite and prerendered to static files.
Tailwind, shiki and twoslash for the code, mermaid for the diagrams. oxlint
for lint, vitest for tests, bun as the runtime.

Dependency versions are pinned exactly, with no ranges. The chapters compile
against `effect` at an rc, and a range there moves the types out from under a
snippet that was passing yesterday.

## Repository layout

`content/` is the writing, `src/` is the site, `scripts/check-content.ts` is
the gate over the writing, and everything else is configuration. There is no
separate app directory: the Fumadocs migration finished and moved in here.
