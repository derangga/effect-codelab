import { createFileRoute, Link } from '@tanstack/react-router'
import type { Chapter } from '@/content'
import { tracks } from '@/content'

const allChapters = tracks.flatMap((t) => t.chapters)

export const Route = createFileRoute('/')({ component: Home })

function ChapterLink({ meta }: Pick<Chapter, 'meta'>) {
  return (
    <Link
      to="/learn/$slug"
      params={{ slug: meta.slug }}
      className="hover:bg-accent block rounded-lg border p-4 transition-colors"
    >
      <div className="flex items-baseline gap-3">
        <span className="text-muted-foreground text-sm tabular-nums">
          {String(meta.order).padStart(2, '0')}
        </span>
        <span className="font-medium">{meta.title}</span>
      </div>
      {meta.summary ? (
        <p className="text-muted-foreground mt-1 pl-9 text-sm">
          {meta.summary}
        </p>
      ) : null}
    </Link>
  )
}

function Home() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-4xl font-bold tracking-tight">Learning Effect</h1>
      <p className="text-muted-foreground mt-3 text-lg">
        A short course on the Effect library for TypeScript. Start at chapter
        one and read in order. Each chapter builds on the one before it.
      </p>

      <ol className="mt-10 space-y-2">
        {allChapters.map(({ meta }: Chapter) => (
          <li key={meta.slug}>
            <ChapterLink meta={meta} />
          </li>
        ))}
      </ol>
    </div>
  )
}
