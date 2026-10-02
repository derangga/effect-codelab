import { useState } from 'react'
import { type BumpState, fiberIds, runBumps } from '@/effect-demo/lock'
import { Board, Panel, RunButtons, useFlip, useRun } from './demo-kit'

const sleepMs = 500
type Bump = { state: BumpState; value: number }
const idle = (): Array<Bump> => fiberIds.map(() => ({ state: 'waiting', value: 0 }))
const columns = [
  { title: 'Waiting', states: ['waiting'] },
  { title: 'Read, now working', states: ['running'] },
  { title: 'Wrote', states: ['done'] },
]
// The board's colours are named after task states.
const colour = { waiting: 'waiting', read: 'running', wrote: 'done' }

/**
 * Nine fibers add one to a counter in three steps: read, sleep, write. Each
 * token shows the number its fiber read, then the number it wrote. Without the
 * lock all nine read 0. With it, each one reads what the last one wrote.
 */
export default function LockDemo() {
  const [locked, setLocked] = useState(false)
  const [bumps, setBumps] = useState(idle)
  const [counter, setCounter] = useState(0)
  const { running, start, stop } = useRun()
  const { root, capture } = useFlip()

  const clear = () => {
    capture()
    setBumps(idle())
    setCounter(0)
  }
  const reset = () => {
    stop()
    clear()
  }
  const run = () => {
    clear()
    start((live) =>
      runBumps({ locked, sleepMs }, (fiber, state, value) => {
        if (!live()) return
        capture()
        setBumps((prev) => prev.map((b, i) => (fiberIds[i] === fiber ? { state, value } : b)))
        if (state === 'wrote') setCounter(value)
      }),
    )
  }

  const finished = bumps.every((bump) => bump.state === 'wrote')
  const lost = fiberIds.length - counter
  const verdict = !finished
    ? ''
    : lost === 0
      ? 'Nine fibers added one, and no update was lost.'
      : `Nine fibers added one, and ${lost} updates were lost.`

  return (
    <Panel ref={root}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={locked}
            onChange={(e) => {
              reset()
              setLocked(e.target.checked)
            }}
          />
          Lock with a one-permit semaphore
        </label>
        <RunButtons running={running} onRun={run} onReset={reset} />
      </div>

      <p className="mt-4 font-mono text-sm" role="status">
        counter = <span className="font-bold text-base">{counter}</span> {verdict}
      </p>
      <Board
        columns={columns}
        tokens={fiberIds.map((fiber, i) => ({
          id: fiber,
          state: colour[bumps[i].state],
          label:
            bumps[i].state === 'waiting'
              ? `#${fiber}`
              : `#${fiber} ${bumps[i].state} ${bumps[i].value}`,
          progressMs: bumps[i].state === 'read' ? sleepMs : undefined,
        }))}
      />
    </Panel>
  )
}
