# Effect Codelab

A site that teaches the [Effect](https://effect.website) library for
TypeScript, at [effect.rangga.site](https://effect.rangga.site). Six tracks,
42 chapters, from the mental model through anti-patterns to a fullstack
monorepo.

Every snippet marked `twoslash` is compiled by the build. An example that does
not typecheck fails the build instead of reaching a reader, so the code on the
page is code that runs.

## Development

```bash
bun install
bun run dev       # dev server on :3000
```

| Command | What it does |
| --- | --- |
| `bun run dev` | dev server on :3000 |
| `bun run build` | static build, compiles every snippet |
| `bun run check:content` | the writing rules, over the markdown source |
| `bun run test` | vitest |
| `bun run lint` | oxlint |
| `bun run types:check` | tsc |
| `bun run deploy` | build, then deploy to Cloudflare |

`check:content` is the one to run before committing prose. It enforces what
can be enforced: no em dashes, every chapter leaving the reader something
runnable, no link pointing at a page that does not exist, no track naming a
theme that is not in `themes.json`, no order used twice. It compiles nothing,
so run `bun run build` for the snippets.

Dependency versions are pinned exactly, with no ranges. The chapters compile
against `effect` at an rc, and a range there moves the types out from under a
snippet that was passing yesterday.

## Writing

`content/` holds one folder per track, each with an `index.md` and its
chapters. Nothing is registered anywhere: Fumadocs reads the folder, and
ordering comes from the `01-` prefix on each filename. Themes are the
exception, living in frontmatter and `content/themes.json`, which is what
keeps `content/` flat.

Adding a **chapter** is dropping a `.md` file into a track folder. Adding a
**track** is making a folder with an `index.md` in it, naming a theme from
`themes.json`. Adding a **theme** is one line in `themes.json`.

[CONTENT.md](CONTENT.md) is the full guide: the frontmatter fields, the prose
rules, how to write a compiled snippet, and how to draw a diagram that
survives the escaping. `scripts/chapter-template.md` is a skeleton worth
copying.

## License

[MIT](LICENSE), covering the code and the chapters alike.
