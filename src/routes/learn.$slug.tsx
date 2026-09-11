import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { ChapterContent } from '@/components/chapter-content'
import { findChapter, neighbours } from '@/content'

export const Route = createFileRoute('/learn/$slug')({
  loader: ({ params }) => {
    const chapter = findChapter(params.slug)
    if (!chapter) throw notFound()
    return { chapter, ...neighbours(chapter.meta.track, params.slug) }
  },
  component: Chapter,
  notFoundComponent: () => (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-bold">No such chapter</h1>
      <Link
        to="/"
        className="text-muted-foreground mt-2 inline-block underline"
      >
        Back to the chapter list
      </Link>
    </div>
  ),
})

function Chapter() {
  const { chapter, prev, next } = Route.useLoaderData()

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-8">
        <p className="text-muted-foreground text-sm tabular-nums">
          Chapter {String(chapter.meta.order).padStart(2, '0')}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          {chapter.meta.title}
        </h1>
        {chapter.meta.summary ? (
          <p className="text-muted-foreground mt-2 text-lg">
            {chapter.meta.summary}
          </p>
        ) : null}
      </header>

      <ChapterContent html={chapter.html} hasMermaid={chapter.hasMermaid} />

      <nav className="mt-16 grid gap-3 border-t pt-6 sm:grid-cols-2">
        {prev ? (
          <Link
            to="/learn/$slug"
            params={{ slug: prev.meta.slug }}
            className="hover:bg-accent flex items-center gap-3 rounded-lg border p-4 transition-colors"
          >
            <ArrowLeft className="size-4 shrink-0" />
            <span>
              <span className="text-muted-foreground block text-xs">
                Previous
              </span>
              <span className="font-medium">{prev.meta.title}</span>
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            to="/learn/$slug"
            params={{ slug: next.meta.slug }}
            className="hover:bg-accent flex items-center justify-end gap-3 rounded-lg border p-4 text-right transition-colors sm:col-start-2"
          >
            <span>
              <span className="text-muted-foreground block text-xs">Next</span>
              <span className="font-medium">{next.meta.title}</span>
            </span>
            <ArrowRight className="size-4 shrink-0" />
          </Link>
        ) : null}
      </nav>
    </article>
  )
}
