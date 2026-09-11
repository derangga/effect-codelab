import { createFileRoute, Link } from '@tanstack/react-router'
import { TrackIcon } from '@/components/track-icon'
import { tracks } from '@/content'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-4xl font-bold tracking-tight">Learning Effect</h1>
      <p className="text-muted-foreground mt-3 text-lg">
        Four tracks on the Effect library for TypeScript. They do not have to be
        read in order, but each one says what it assumes you already know.
      </p>

      <ul className="mt-10 grid gap-3 sm:grid-cols-2">
        {tracks.map(({ meta }) => (
          <li key={meta.slug}>
            <Link
              to="/learn/$track"
              params={{ track: meta.slug }}
              className="hover:bg-accent flex h-full flex-col rounded-lg border p-5 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <TrackIcon
                  name={meta.icon}
                  className="text-muted-foreground size-4 shrink-0"
                />
                <span className="font-medium">{meta.title}</span>
              </div>
              <p className="text-muted-foreground mt-2 grow text-sm">
                {meta.summary}
              </p>
              <p className="text-muted-foreground mt-4 text-xs">
                {meta.prereq}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
