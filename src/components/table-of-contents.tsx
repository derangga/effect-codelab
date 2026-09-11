import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Heading } from '../../vite-plugin-markdown'

/**
 * Which heading to mark, given where each one currently sits relative to the
 * top of the viewport. Pure, and separate from the DOM reads, because both
 * bugs this has had were in the decision rather than in the measuring.
 *
 * A heading counts as reached at 100px rather than 0, so it lands under the
 * sticky header instead of level with it.
 */
export function activeHeadingId(
  tops: Array<{ id: string; top: number }>,
  atBottom: boolean,
) {
  if (tops.length === 0) return undefined

  // A last section shorter than the viewport never reaches the threshold: the
  // page runs out of scroll with the heading still halfway down. At the bottom
  // of the document that heading is what the reader is looking at, whatever
  // its offset says.
  if (atBottom) return tops[tops.length - 1]?.id

  let current = tops[0]?.id
  for (const { id, top } of tops) {
    if (top < 100) current = id
  }
  return current
}

/**
 * Marks whichever heading is nearest the top of the viewport. The prose is
 * written into the DOM by an effect in ChapterContent, so the elements do not
 * exist during render; this runs as a parent effect, which React fires after
 * the child's, and reads them from the document then.
 */
function useActiveHeading(headings: Array<Heading>) {
  const [active, setActive] = useState<string>()

  useEffect(() => {
    if (headings.length === 0) return

    const onScroll = () => {
      // ponytail: reads every heading's rect per scroll. Fifteen headings is
      // the worst case here. Throttle with rAF if a page ever gets long
      // enough to feel it.
      const tops = headings.flatMap(({ id }) => {
        const top = document.getElementById(id)?.getBoundingClientRect().top
        return top === undefined ? [] : [{ id, top }]
      })

      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2

      setActive(activeHeadingId(tops, atBottom))
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })

    // Mermaid draws after the page has settled, and a chapter that grows
    // taller once the diagrams land leaves the last scroll event's answer
    // stale. Recomputing on resize is what makes a deep link to the final
    // section mark that section on arrival rather than on the first nudge of
    // the wheel.
    const observer = new ResizeObserver(onScroll)
    observer.observe(document.documentElement)

    return () => {
      window.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [headings])

  return active
}

export function TableOfContents({ headings }: { headings: Array<Heading> }) {
  const active = useActiveHeading(headings)

  if (headings.length === 0) return null

  return (
    <nav
      aria-label="On this page"
      className="sticky top-12 hidden h-fit w-56 shrink-0 py-10 xl:block"
    >
      <p className="text-muted-foreground mb-3 text-xs font-medium tracking-wide uppercase">
        On this page
      </p>
      <ul className="space-y-1.5 text-sm">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className={cn(
                'hover:text-foreground block transition-colors',
                heading.depth === 3 && 'pl-4',
                heading.id === active
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground',
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
