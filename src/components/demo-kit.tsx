import { Effect, type Fiber } from 'effect'
import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '@/lib/cn'
import { button, outline, primary } from '@/lib/demo-ui'

/**
 * What every chapter simulator shares: one run at a time, a dial, the two
 * buttons, the columns of task tokens, and the motion between them.
 */

type Look = {
  rect: DOMRect
  backgroundColor: string
  borderColor: string
  color: string
  boxShadow: string
}

const travel = { duration: 450, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', id: 'flip' }

/**
 * Makes tokens travel instead of jump. A token that changes column is a new
 * element in a new place, so `capture` records where every token is and what
 * it looks like just before a state change, and after the render each token
 * animates from there to where it now sits. Call `capture` before the
 * `setState`, and put `root` on an element that contains every token.
 */
export function useFlip() {
  const root = useRef<HTMLDivElement>(null)
  const before = useRef<Map<string, Look> | undefined>(undefined)
  const tokens = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[data-flip]') ?? [])

  const capture = () => {
    before.current = new Map(
      tokens().map((el) => {
        const { backgroundColor, borderColor, color, boxShadow } = getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        return [el.dataset.flip!, { rect, backgroundColor, borderColor, color, boxShadow }]
      }),
    )
  }

  useLayoutEffect(() => {
    const was = before.current
    before.current = undefined
    if (!was || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const el of tokens()) {
      // A token caught mid-flight was captured where it was on screen, so its
      // old flight ends here and the new one starts from that spot.
      for (const flight of el.getAnimations()) if (flight.id === travel.id) flight.cancel()
      const from = was.get(el.dataset.flip!)
      if (!from) {
        el.animate([{ opacity: 0, transform: 'scale(0.6)' }, {}], travel)
        continue
      }
      const { rect, ...colours } = from
      const now = el.getBoundingClientRect()
      const dx = rect.left - now.left
      const dy = rect.top - now.top
      const repainted = colours.backgroundColor !== getComputedStyle(el).backgroundColor
      if (dx === 0 && dy === 0 && !repainted) continue
      el.animate([{ transform: `translate(${dx}px, ${dy}px)`, ...colours }, {}], travel)
    }
  })

  return { root, capture }
}

/**
 * Runs one program at a time. Starting a new run, stopping, and leaving the
 * page all interrupt the run in flight.
 */
export function useRun() {
  const [running, setRunning] = useState(false)
  const generation = useRef(0)
  const fiber = useRef<Fiber.Fiber<unknown, unknown> | undefined>(undefined)

  const halt = () => {
    generation.current++
    fiber.current?.interruptUnsafe()
    fiber.current = undefined
  }
  useEffect(() => halt, [])

  return {
    running,
    stop: () => {
      halt()
      setRunning(false)
    },
    // An interrupted task still fires its callbacks while it unwinds, so the
    // program gets `live` to ignore a callback from a run that is no longer
    // current.
    start: (program: (live: () => boolean) => Effect.Effect<unknown, unknown>) => {
      halt()
      setRunning(true)
      const mine = ++generation.current
      const live = () => generation.current === mine
      const next = Effect.runFork(program(live))
      fiber.current = next
      next.addObserver(() => {
        if (live()) setRunning(false)
      })
    },
  }
}

export function Panel({ children, ref }: { children: ReactNode; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="my-6 rounded-2xl border bg-fd-card p-5">
      {children}
    </div>
  )
}

export function Dial(props: {
  label: string
  min: number
  max: number
  step?: number
  value: number
  /** What the reader sees next to the slider, when it is not the bare number. */
  shown?: string
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="font-medium text-sm">
        {props.label}
      </label>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <output htmlFor={id} className="font-bold font-mono text-sm">
        {props.shown ?? props.value}
      </output>
    </div>
  )
}

export function RunButtons(props: { running: boolean; onRun: () => void; onReset: () => void }) {
  return (
    <div className="ml-auto flex gap-2">
      <button
        type="button"
        className={cn(button, primary, 'px-4 py-2')}
        onClick={props.onRun}
        disabled={props.running}
      >
        Run
      </button>
      <button type="button" className={cn(button, outline, 'px-4 py-2')} onClick={props.onReset}>
        Reset
      </button>
    </div>
  )
}

/**
 * `id` makes the token one that `useFlip` moves. `progressMs` fills it from
 * the left over that long, starting when it appears.
 */
export function Token(props: {
  id?: number
  state: string
  progressMs?: number
  children: ReactNode
}) {
  return (
    <li
      className="gate-token m-0! flex h-7 min-w-16 items-center justify-center rounded-lg px-2 font-bold font-mono text-xs"
      data-state={props.state}
      data-flip={props.id}
      data-progress={props.progressMs === undefined ? undefined : ''}
      style={
        props.progressMs === undefined
          ? undefined
          : ({ '--progress': `${props.progressMs}ms` } as CSSProperties)
      }
    >
      {props.children}
    </li>
  )
}

/** One column per group of states, each task drawn in the column its state belongs to. */
export function Board(props: {
  columns: ReadonlyArray<{ title: string; states: ReadonlyArray<string> }>
  tokens: ReadonlyArray<{ id: number; state: string; label: string; progressMs?: number }>
}) {
  return (
    <div className="mt-3 flex gap-4">
      {props.columns.map((column) => (
        <div key={column.title} className="flex-1">
          <h3 className="mb-2 font-semibold text-[11px] text-fd-muted-foreground uppercase tracking-wider">
            {column.title}
          </h3>
          {/* Nine tokens sit two to a row, so five rows keeps the panel from growing mid-run. */}
          <ul className="m-0 flex min-h-44 list-none flex-wrap content-start gap-2 p-0">
            {props.tokens.map((token) =>
              column.states.includes(token.state) ? (
                <Token
                  key={token.id}
                  id={token.id}
                  state={token.state}
                  progressMs={token.progressMs}
                >
                  {token.label}
                </Token>
              ) : null,
            )}
          </ul>
        </div>
      ))}
    </div>
  )
}
