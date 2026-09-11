import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { ChapterContent } from '@/components/chapter-content'
import { TrackIcon } from '@/components/track-icon'
import { chapterBySlug, neighbours, nextTrack, trackBySlug } from '@/content'

export const Route = createFileRoute('/learn/$track/$slug')({
  loader: ({ params }) => {
    const track = trackBySlug(params.track)
    const chapter = chapterBySlug(params.track, params.slug)
    if (!track || !chapter) throw notFound()
    return {
      track,
      chapter,
      ...neighbours(params.track, params.slug),
      after: nextTrack(params.track),
    }
  },
  component: Chapter,
  notFoundComponent: () => (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-bold">No such chapter</h1>
      <Link
        to="/"
        className="text-muted-foreground mt-2 inline-block underline"
      >
        Back to the tracks
      </Link>
    </div>
  ),
})

function Chapter() {
  const { track, chapter, prev, next, after } = Route.useLoaderData()
  const params = { track: track.meta.slug }

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-8">
        <Link
          to="/learn/$track"
          params={params}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm transition-colors"
        >
          <TrackIcon name={track.meta.icon} className="size-4 shrink-0" />
          <span>{track.meta.title}</span>
          <span className="tabular-nums">
            {String(chapter.meta.order).padStart(2, '0')}
          </span>
        </Link>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          {chapter.meta.title}
        </h1>
        {chapter.meta.summary ? (
          <p className="text-muted-foreground mt-2 text-lg">
            {chapter.meta.summary}
          </p>
        ) : null}
      </header>

      {chapter.meta.draft ? (
        <p className="border-muted-foreground/30 bg-muted/40 text-muted-foreground mb-8 rounded-lg border border-dashed p-4 text-sm">
          This page is an outline. The headings say what it will cover, and the
          prose is not written yet.
        </p>
      ) : null}

      <ChapterContent html={chapter.html} hasMermaid={chapter.hasMermaid} />

      <nav className="mt-16 grid gap-3 border-t pt-6 sm:grid-cols-2">
        {prev ? (
          <Link
            to="/learn/$track/$slug"
            params={{ ...params, slug: prev.meta.slug }}
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
            to="/learn/$track/$slug"
            params={{ ...params, slug: next.meta.slug }}
            className="hover:bg-accent flex items-center justify-end gap-3 rounded-lg border p-4 text-right transition-colors sm:col-start-2"
          >
            <span>
              <span className="text-muted-foreground block text-xs">Next</span>
              <span className="font-medium">{next.meta.title}</span>
            </span>
            <ArrowRight className="size-4 shrink-0" />
          </Link>
        ) : after ? (
          // The end of a track. The tracks do not form one reading order, so
          // this suggests the next track rather than linking into it as if it
          // were the next chapter.
          <Link
            to="/learn/$track"
            params={{ track: after.meta.slug }}
            className="hover:bg-accent flex items-center justify-end gap-3 rounded-lg border p-4 text-right transition-colors sm:col-start-2"
          >
            <span>
              <span className="text-muted-foreground block text-xs">
                End of {track.meta.title}. Next track
              </span>
              <span className="font-medium">{after.meta.title}</span>
            </span>
            <TrackIcon name={after.meta.icon} className="size-4 shrink-0" />
          </Link>
        ) : null}
      </nav>
    </article>
  )
}
