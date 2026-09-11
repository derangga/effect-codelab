import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ChapterContent } from '@/components/chapter-content'
import { TrackIcon } from '@/components/track-icon'
import { Badge } from '@/components/ui/badge'
import { trackBySlug } from '@/content'

export const Route = createFileRoute('/learn/$track/')({
  loader: ({ params }) => {
    const track = trackBySlug(params.track)
    if (!track) throw notFound()
    return { track }
  },
  component: TrackPage,
  notFoundComponent: () => (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-bold">No such track</h1>
      <Link
        to="/"
        className="text-muted-foreground mt-2 inline-block underline"
      >
        Back to the tracks
      </Link>
    </div>
  ),
})

function TrackPage() {
  const { track } = Route.useLoaderData()

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-8">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <TrackIcon name={track.meta.icon} className="size-4 shrink-0" />
          <span>{track.meta.prereq}</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          {track.meta.title}
        </h1>
        <p className="text-muted-foreground mt-2 text-lg">
          {track.meta.summary}
        </p>
      </header>

      <ChapterContent html={track.html} hasMermaid={track.hasMermaid} />

      {track.chapters.length > 0 ? (
        <ol className="mt-10 space-y-2 border-t pt-8">
          {track.chapters.map(({ meta }) => (
            <li key={meta.slug}>
              <Link
                to="/learn/$track/$slug"
                params={{ track: track.meta.slug, slug: meta.slug }}
                className="hover:bg-accent block rounded-lg border p-4 transition-colors"
              >
                <div className="flex items-baseline gap-3">
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {String(meta.order).padStart(2, '0')}
                  </span>
                  <span className="font-medium">{meta.title}</span>
                  {meta.draft ? (
                    <Badge variant="outline" className="ml-auto">
                      Draft
                    </Badge>
                  ) : null}
                </div>
                {meta.summary ? (
                  <p className="text-muted-foreground mt-1 pl-9 text-sm">
                    {meta.summary}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground mt-10 rounded-lg border border-dashed p-6 text-sm">
          This track has no pages yet.
        </p>
      )}
    </div>
  )
}
