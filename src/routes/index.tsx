import { createFileRoute, Link } from '@tanstack/react-router'
import { Clock } from 'lucide-react'
import { TrackIcon } from '@/components/track-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { themes, tracks } from '@/content'

export const Route = createFileRoute('/')({ component: Home })

const first = tracks[0]

function Home() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <header className="max-w-2xl">
        <h1 className="text-4xl font-bold tracking-tight">Learning Effect</h1>
        <p className="text-muted-foreground mt-3 text-lg">
          Short tracks on the Effect library for TypeScript. Every snippet on
          this site is compiled by the build, so the code you read is code that
          runs.
        </p>
        <p className="text-muted-foreground mt-3">
          If you are new here, read Mental Model first, then Basic Effect front
          to back. Anti-patterns is worth a pass once the basics stick, and
          Fullstack Monorepo is where it all gets wired into an app.
        </p>
        <div className="mt-6 flex items-center gap-4">
          {first ? (
            <Button
              render={
                <Link to="/learn/$track" params={{ track: first.meta.slug }}>
                  Start with {first.meta.title}
                </Link>
              }
            />
          ) : null}
          <Link to="/demo" className="text-sm underline underline-offset-4">
            See it running
          </Link>
        </div>
      </header>

      {/* A theme with no tracks yet is left out rather than rendered as an
          empty heading, so themes.json can name one before it has content. */}
      {themes
        .filter((theme) => theme.tracks.length > 0)
        .map((theme) => (
          <section key={theme.slug} className="mt-12">
            <h2 className="text-sm font-medium tracking-wide uppercase">
              {theme.title}
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {theme.tracks.map((track) => (
                <li key={track.meta.slug}>
                  <Link
                    to="/learn/$track"
                    params={{ track: track.meta.slug }}
                    className="hover:bg-accent flex h-full flex-col rounded-lg border p-5 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <TrackIcon
                        name={track.meta.icon}
                        className="text-muted-foreground size-4 shrink-0"
                      />
                      <span className="font-medium">{track.meta.title}</span>
                    </div>
                    <p className="text-muted-foreground mt-2 grow text-sm">
                      {track.meta.summary}
                    </p>
                    <div className="mt-4 flex items-center gap-2">
                      <Badge variant="secondary">{track.meta.level}</Badge>
                      <span className="text-muted-foreground flex items-center gap-1 text-xs">
                        <Clock className="size-3" />
                        {`${track.totalMinutes} min`}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  )
}
