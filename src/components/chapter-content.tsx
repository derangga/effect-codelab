import { useEffect, useRef, useState } from 'react'

/** Watch the html element for the dark class, so mermaid can re-theme. */
function useIsDark() {
  const [dark, setDark] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark'),
  )

  useEffect(() => {
    const el = document.documentElement
    const observer = new MutationObserver(() =>
      setDark(el.classList.contains('dark')),
    )
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return dark
}

/** Add a copy button to every highlighted code block. */
function addCopyButtons(root: HTMLElement) {
  for (const pre of root.querySelectorAll('pre.shiki')) {
    if (!(pre instanceof HTMLElement)) continue

    // The button lives on a wrapper, not inside the pre. The pre is the
    // scrolling box, so a button inside it slides away with the code.
    const wrapper = document.createElement('div')
    wrapper.className = 'code-block'
    pre.replaceWith(wrapper)
    wrapper.appendChild(pre)

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'copy-button'
    button.textContent = 'Copy'
    button.setAttribute('aria-label', 'Copy code')

    button.addEventListener('click', async () => {
      // Twoslash injects popups into the DOM; the code element's text is
      // still the source the reader sees, so copy exactly that.
      const code = pre.querySelector('code')?.textContent ?? ''
      try {
        await navigator.clipboard.writeText(code)
        button.textContent = 'Copied'
      } catch {
        // Denied permission or an insecure context. Say so rather than
        // looking like the click did nothing.
        button.textContent = 'Failed'
      }
      setTimeout(() => {
        button.textContent = 'Copy'
      }, 1500)
    })

    wrapper.appendChild(button)
  }
}

/**
 * Draw the diagrams, loading mermaid only for chapters that have one. It is
 * around half a megabyte, so a chapter without a diagram must not pay for it.
 */
function drawMermaid(root: HTMLElement, dark: boolean) {
  const nodes = root.querySelectorAll<HTMLElement>('pre.mermaid')
  if (nodes.length === 0) return

  let cancelled = false

  void (async () => {
    const mermaid = (await import('mermaid')).default
    // The reader may have moved on while the import was in flight.
    if (cancelled || !root.isConnected) return

    for (const node of nodes) {
      // Mermaid replaces the element's contents with an SVG, so keep the
      // source around or a re-theme has nothing left to draw from.
      node.dataset.source ??= node.textContent ?? ''
      node.textContent = node.dataset.source
      node.removeAttribute('data-processed')
    }

    mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default' })
    await mermaid.run({ nodes: Array.from(nodes) })
  })()

  return () => {
    cancelled = true
  }
}

export function ChapterContent({
  html,
  hasMermaid,
}: {
  html: string
  hasMermaid: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dark = useIsDark()

  /**
   * The markup is written here rather than with dangerouslySetInnerHTML, and
   * that is deliberate. React rewrote the container's innerHTML after these
   * effects had already run: the copy buttons were built and then thrown away,
   * and mermaid finished loading to find its node detached, so navigating back
   * to a chapter you had already visited showed no diagrams. Owning the write
   * means the decoration cannot be undone by a commit we do not control.
   */
  useEffect(() => {
    const root = ref.current
    if (!root) return

    root.innerHTML = html
    addCopyButtons(root)

    return hasMermaid ? drawMermaid(root, dark) : undefined
  }, [html, hasMermaid, dark])

  return <div ref={ref} className="chapter-prose" />
}
