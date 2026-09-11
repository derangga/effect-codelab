import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Heading } from '../../vite-plugin-markdown'

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
      let current = headings[0]?.id
      for (const { id } of headings) {
        const top = document.getElementById(id)?.getBoundingClientRect().top
        // 100px down, so a heading counts as reached once it is under the
        // sticky header rather than when it leaves the viewport.
        if (top !== undefined && top < 100) current = id
      }
      setActive(current)
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
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
