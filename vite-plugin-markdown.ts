import { readFile } from 'node:fs/promises'
import matter from 'gray-matter'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeShiki from '@shikijs/rehype'
import { transformerTwoslash } from '@shikijs/twoslash'
import { toString } from 'hast-util-to-string'
import ts from 'typescript'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { Element, Root } from 'hast'
import type { Plugin } from 'vite'

export type ChapterMeta = {
  kind: 'chapter'
  /** Folder name under content/. The track this chapter belongs to. */
  track: string
  title: string
  order: number
  slug: string
  summary: string
  /** An outline with no prose yet. Badged in the sidebar, exempt from the
   * runnable-snippet rule. */
  draft: boolean
}

/** The levels a track may declare. check:content rejects anything else. */
export const LEVELS = ['beginner', 'intermediate'] as const

export type Level = (typeof LEVELS)[number]

/** The `_track.md` in a track folder. Its body renders as the track page. */
export type TrackMeta = {
  kind: 'track'
  /** Folder name under content/. */
  slug: string
  title: string
  /** Orders this track within its theme, not across the site. */
  order: number
  /** A slug from content/themes.json. */
  theme: string
  level: Level
  summary: string
  /** A lucide icon name, shown on the home card and in the sidebar switcher. */
  icon: string
  /** One line naming what this track assumes you have read. */
  prereq: string
}

export type Heading = { depth: number; id: string; text: string }

/**
 * Minutes to read a page, from its word count. Prose goes at 200 words a
 * minute, and code is counted by the line instead, because 15 lines a minute
 * is closer to how a reader actually works through a snippet than treating its
 * tokens as prose. Both are estimates, and the point is only that a two minute
 * page and a twenty minute page look different on a card.
 */
function readingMinutes(markdown: string) {
  const fences = [...markdown.matchAll(/^```[\s\S]*?^```$/gm)]
  const codeLines = fences.reduce(
    (total, [block]) => total + block.split('\n').length,
    0,
  )
  const prose = markdown.replace(/^```[\s\S]*?^```$/gm, ' ')
  const words = prose.split(/\s+/).filter(Boolean).length

  return Math.max(1, Math.ceil(words / 200 + codeLines / 15))
}

/**
 * Pull `pre > code.language-mermaid` out of the tree before shiki sees it.
 * Shiki only matches `pre > code[class*="language-"]`, so replacing the whole
 * `pre` with a bare `<pre class="mermaid">` makes it invisible to the
 * highlighter and leaves the diagram source verbatim for client-side mermaid.
 */
function rehypeMermaid() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'pre' || index === undefined || !parent) return
      const code = node.children.find(
        (c): c is Element => c.type === 'element' && c.tagName === 'code',
      )
      if (!code) return
      const classes = code.properties?.className
      const isMermaid =
        Array.isArray(classes) && classes.includes('language-mermaid')
      if (!isMermaid) return

      // Mermaid strips anything that looks like a tag from a label, so a
      // label like Effect<A, E, R> renders as "Effect". Its own escape is a
      // numeric entity. Rewrite only inside quoted labels, because the > in
      // an arrow like --> must survive.
      const source = toString(code).replace(
        /"([^"]*)"/g,
        (_, label: string) =>
          `"${label.replaceAll('<', '#60;').replaceAll('>', '#62;')}"`,
      )

      parent.children[index] = {
        type: 'element',
        tagName: 'pre',
        properties: { className: ['mermaid'] },
        children: [{ type: 'text', value: source }],
      }
    })
  }
}

/** Collect h2/h3 (already id'd by rehype-slug) into a flat TOC. */
function rehypeCollectHeadings(headings: Array<Heading>) {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (!/^h[23]$/.test(node.tagName)) return
      const id = node.properties?.id
      if (typeof id !== 'string') return
      headings.push({
        depth: Number(node.tagName[1]),
        id,
        text: toString(node),
      })
    })
  }
}

// Twoslash compiles snippets against the app's own tsconfig-ish settings.
// Effect needs `strict` — without it the E/R channels infer wrong and the
// chapters would teach types the reader will never see in their own project.
const twoslashCompilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
  // vite/client is what makes `import.meta.env` real in snippets. Without it
  // the browser Config chapter renders a red squiggle on the line it teaches.
  types: ['vite/client'],
}

export async function render(source: string, id: string) {
  const { data, content } = matter(source)
  const headings: Array<Heading> = []

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypeCollectHeadings, headings)
    .use(rehypeAutolinkHeadings, { behavior: 'wrap' })
    .use(rehypeMermaid)
    .use(rehypeShiki, {
      themes: { light: 'github-light', dark: 'github-dark' },
      transformers: [
        transformerTwoslash({
          // Only blocks tagged ```ts twoslash are compiled. Not every snippet
          // is standalone-compilable; opting in per block keeps the build
          // honest instead of forcing every example to be a whole file.
          explicitTrigger: true,
          twoslashOptions: {
            compilerOptions: twoslashCompilerOptions,
            // Drop hover popups. They are a twoslash default, not something
            // this course needs: the popup is absolutely positioned and gets
            // clipped by the code block it lives in, and a type worth teaching
            // should be pinned with `^?` rather than hidden behind a hover.
            // Filtering the nodes also removes the dotted underlines, which
            // otherwise advertise an interaction that no longer does anything.
            filterNode: (node) => node.type !== 'hover',
          },
          // `^?` renders as a block under the line instead of an absolutely
          // positioned popup. The popup is clipped by the code block's own
          // horizontal scrolling, and a reader should not have to hover to
          // see the type the chapter is making a point about.
          rendererRich: { queryRendering: 'line' },
        }),
      ],
    })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(content)

  const segments = id.split('/')
  const filename = segments.pop()!.replace(/\.md$/, '')
  const folder = segments.pop() ?? ''

  // The filename decides the shape: _track.md describes the folder it sits in,
  // anything else is a chapter belonging to that folder.
  const meta: ChapterMeta | TrackMeta =
    filename === '_track'
      ? {
          kind: 'track',
          slug: folder,
          title: data.title ?? folder,
          order: data.order ?? 999,
          theme: data.theme ?? '',
          level: LEVELS.includes(data.level) ? data.level : 'beginner',
          summary: data.summary ?? '',
          icon: data.icon ?? 'BookOpen',
          prereq: data.prereq ?? '',
        }
      : {
          kind: 'chapter',
          track: folder,
          title: data.title ?? filename,
          order: data.order ?? 999,
          slug: filename,
          summary: data.summary ?? '',
          draft: data.draft === true,
        }

  // The slug is the filename, so a URL is always findable from the tree. A
  // frontmatter slug is allowed only when it agrees, which keeps the field
  // from drifting into a second source of truth.
  if (data.slug !== undefined && data.slug !== meta.slug) {
    throw new Error(
      `${id}: frontmatter slug "${data.slug}" does not match the filename "${meta.slug}"`,
    )
  }

  // A chapter with a diagram pays for mermaid; one without must not.
  const hasMermaid = String(file).includes('class="mermaid"')

  return {
    meta,
    headings,
    hasMermaid,
    minutes: readingMinutes(content),
    html: String(file),
  }
}

export function markdown(): Plugin {
  return {
    name: 'learning-markdown',
    enforce: 'pre',
    async transform(source, id) {
      if (!id.endsWith('.md')) return null
      const { meta, headings, hasMermaid, minutes, html } = await render(
        source,
        id,
      )
      return {
        code: [
          `export const meta = ${JSON.stringify(meta)}`,
          `export const headings = ${JSON.stringify(headings)}`,
          `export const hasMermaid = ${JSON.stringify(hasMermaid)}`,
          `export const minutes = ${JSON.stringify(minutes)}`,
          `export const html = ${JSON.stringify(html)}`,
          `export default html`,
        ].join('\n'),
        map: null,
      }
    },
    // Full reload on content edits: the HTML is a build artifact, there is no
    // meaningful partial update to apply.
    async handleHotUpdate({ file, server }) {
      if (!file.endsWith('.md')) return
      // Surface twoslash errors in the terminal instead of a silent stale page.
      await render(await readFile(file, 'utf8'), file)
      server.hot.send({ type: 'full-reload' })
    },
  }
}
